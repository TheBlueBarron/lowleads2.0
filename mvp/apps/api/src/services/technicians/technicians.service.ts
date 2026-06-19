import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError, ConflictError, ForbiddenError, ValidationError } from '../../lib/errors.js';
import { TIER_LIMITS } from '@lowleads/shared-types';
import type { CreateTechnicianBody, UpdateTechnicianBody } from './technicians.schema.js';

export interface TechnicianServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
}

interface TechnicianRow {
  id: string;
  user_id: string;
  company_id: string;
  display_name: string;
  total_leads_submitted: number;
  not_qualified_count: number;
  total_earned_cents: number;
  escrow_balance_cents: number;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

interface TechnicianPerformanceRow {
  id: string;
  display_name: string;
  is_active: boolean;
  escrow_balance_cents: number;
  leads_submitted: string;
  leads_closed: string;
  total_earned_cents: string;
}

export class TechnicianService {
  constructor(private readonly deps: TechnicianServiceDeps) {}

  async create(companyId: string, body: CreateTechnicianBody) {
    // Verify tier allows technician accounts
    const companyResult = await this.deps.db.query<{
      subscription_tier: string;
    }>('SELECT subscription_tier FROM companies WHERE id = $1 AND deleted_at IS NULL', [companyId]);
    const company = companyResult.rows[0];
    if (!company) throw new NotFoundError('Company');

    const tier = company.subscription_tier as keyof typeof TIER_LIMITS;
    const limits = TIER_LIMITS[tier];
    if (limits.technicianAccounts === 0) {
      throw new ForbiddenError('Technician accounts require a Pro or Enterprise subscription');
    }

    // Count existing technicians
    if (limits.technicianAccounts !== Infinity) {
      const countResult = await this.deps.db.query<{ count: string }>(
        'SELECT COUNT(*)::text AS count FROM technicians WHERE company_id = $1',
        [companyId],
      );
      const count = parseInt(countResult.rows[0]?.count ?? '0', 10);
      if (count >= limits.technicianAccounts) {
        throw new ForbiddenError(
          `Your plan allows a maximum of ${limits.technicianAccounts} technician accounts`,
        );
      }
    }

    // Verify the user belongs to this company
    const userResult = await this.deps.db.query<{ id: string; company_id: string }>(
      'SELECT id, company_id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [body.userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new NotFoundError('User');
    if (user.company_id !== companyId) {
      throw new ForbiddenError('User does not belong to this company');
    }

    // Check for existing technician record
    const existingResult = await this.deps.db.query<{ id: string }>(
      'SELECT id FROM technicians WHERE user_id = $1',
      [body.userId],
    );
    if (existingResult.rows.length > 0) {
      throw new ConflictError('This user already has a technician record');
    }

    const result = await this.deps.db.query<TechnicianRow>(
      `INSERT INTO technicians (user_id, company_id, display_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [body.userId, companyId, body.displayName],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Technician insert failed');
    return this.toResponse(row);
  }

  async list(companyId: string) {
    const result = await this.deps.db.query<TechnicianRow>(
      `SELECT id, user_id, company_id, display_name, total_leads_submitted,
              not_qualified_count, total_earned_cents, escrow_balance_cents,
              is_active, created_at, updated_at
       FROM technicians
       WHERE company_id = $1
       ORDER BY created_at DESC`,
      [companyId],
    );
    return {
      data: result.rows.map((r) => this.toResponse(r)),
      total: result.rows.length,
    };
  }

  /**
   * Owner-facing employee performance: per-technician leads submitted, closed
   * (sale) count, close rate, lifetime earned (from the technician-payee ledger),
   * and current balance. Counts/earnings use scalar sub-selects rather than joins
   * to avoid the cartesian-product inflation a leads × ledger join would cause.
   */
  async performance(companyId: string) {
    const result = await this.deps.db.query<TechnicianPerformanceRow>(
      `SELECT
         t.id,
         t.display_name,
         t.is_active,
         t.escrow_balance_cents,
         (SELECT COUNT(*) FROM leads l WHERE l.technician_id = t.id) AS leads_submitted,
         (SELECT COUNT(*) FROM leads l WHERE l.technician_id = t.id AND l.status = 'sale')
           AS leads_closed,
         (SELECT COALESCE(SUM(et.amount_cents), 0)
            FROM escrow_transactions et
            WHERE et.technician_id = t.id
              AND et.payee_type = 'technician'
              AND et.type = 'release') AS total_earned_cents
       FROM technicians t
       WHERE t.company_id = $1
       ORDER BY t.created_at DESC`,
      [companyId],
    );

    const data = result.rows.map((r) => {
      const leadsSubmitted = parseInt(r.leads_submitted, 10);
      const leadsClosed = parseInt(r.leads_closed, 10);
      return {
        technicianId: r.id,
        displayName: r.display_name,
        isActive: r.is_active,
        leadsSubmitted,
        leadsClosed,
        closeRate: leadsSubmitted > 0 ? leadsClosed / leadsSubmitted : 0,
        totalEarnedCents: parseInt(r.total_earned_cents, 10),
        balanceCents: r.escrow_balance_cents,
      };
    });

    return { data, total: data.length };
  }

  async update(companyId: string, technicianId: string, body: UpdateTechnicianBody) {
    if (body.displayName === undefined && body.isActive === undefined) {
      throw new ValidationError('No fields to update');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.displayName !== undefined) {
      fields.push(`display_name = $${idx++}`);
      values.push(body.displayName);
    }
    if (body.isActive !== undefined) {
      fields.push(`is_active = $${idx++}`);
      values.push(body.isActive);
    }

    values.push(technicianId, companyId);
    const result = await this.deps.db.query<TechnicianRow>(
      `UPDATE technicians
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND company_id = $${idx} RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Technician');
    return this.toResponse(row);
  }

  private toResponse(row: TechnicianRow) {
    return {
      id: row.id,
      userId: row.user_id,
      companyId: row.company_id,
      displayName: row.display_name,
      totalLeadsSubmitted: row.total_leads_submitted,
      notQualifiedCount: row.not_qualified_count,
      totalEarnedCents: row.total_earned_cents,
      escrowBalanceCents: row.escrow_balance_cents,
      isActive: row.is_active,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
