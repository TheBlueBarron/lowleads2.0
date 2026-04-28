import type { Pool } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import type { UpdateCompanyBody } from './companies.schema.js';

export interface CompanyServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
}

interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  stripe_customer_id: string | null;
  subscription_tier: string;
  subscription_status: string | null;
  transaction_fee_bps: number;
  escrow_balance_cents: number;
  service_area: string[];
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EscrowTxRow {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  lead_id: string | null;
  stripe_payment_intent_id: string | null;
  created_at: Date;
}

export class CompanyService {
  constructor(private readonly deps: CompanyServiceDeps) {}

  async getProfile(companyId: string) {
    const result = await this.deps.db.query<CompanyRow>(
      `SELECT id, name, slug, stripe_customer_id, subscription_tier, subscription_status,
              transaction_fee_bps, escrow_balance_cents, service_area, verified_at, created_at, updated_at
       FROM companies
       WHERE id = $1 AND deleted_at IS NULL`,
      [companyId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Company');
    return this.toResponse(row);
  }

  async updateProfile(companyId: string, body: UpdateCompanyBody) {
    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    if (body.name !== undefined) {
      fields.push(`name = $${idx++}`);
      values.push(body.name);
    }
    if (body.serviceArea !== undefined) {
      fields.push(`service_area = $${idx++}`);
      values.push(body.serviceArea);
    }

    if (fields.length === 0) {
      throw new ValidationError('No fields to update');
    }

    values.push(companyId);
    const result = await this.deps.db.query<CompanyRow>(
      `UPDATE companies SET ${fields.join(', ')} WHERE id = $${idx} AND deleted_at IS NULL RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Company');
    return this.toResponse(row);
  }

  async getEscrowBalance(companyId: string) {
    const balResult = await this.deps.db.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1 AND deleted_at IS NULL',
      [companyId],
    );
    const company = balResult.rows[0];
    if (!company) throw new NotFoundError('Company');

    const reservedResult = await this.deps.db.query<{ reserved: string }>(
      `SELECT COALESCE(SUM(escrow_reserved_cents), 0) AS reserved
       FROM service_listings
       WHERE company_id = $1 AND deleted_at IS NULL AND status IN ('active', 'paused')`,
      [companyId],
    );

    const reserved = parseInt(reservedResult.rows[0]?.reserved ?? '0', 10);

    return {
      balanceCents: company.escrow_balance_cents,
      reservedCents: reserved,
      availableCents: company.escrow_balance_cents - reserved,
    };
  }

  async getEscrowHistory(
    companyId: string,
    opts: { cursor?: string; limit: number },
  ) {
    const limit = Math.min(opts.limit, 100);
    const params: unknown[] = [companyId, limit + 1];

    let cursorClause = '';
    if (opts.cursor) {
      params.push(opts.cursor);
      cursorClause = `AND id < $${params.length}`;
    }

    const result = await this.deps.db.query<EscrowTxRow>(
      `SELECT id, type, amount_cents, balance_after_cents, lead_id, stripe_payment_intent_id, created_at
       FROM escrow_transactions
       WHERE company_id = $1 ${cursorClause}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? (data[data.length - 1]?.id ?? null) : null;

    return {
      transactions: data.map((r) => ({
        id: r.id,
        type: r.type,
        amountCents: r.amount_cents,
        balanceAfterCents: r.balance_after_cents,
        leadId: r.lead_id,
        stripePaymentIntentId: r.stripe_payment_intent_id,
        createdAt: r.created_at.toISOString(),
      })),
      cursor: nextCursor,
      hasMore,
    };
  }

  private toResponse(row: CompanyRow) {
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      subscriptionTier: row.subscription_tier,
      subscriptionStatus: row.subscription_status,
      transactionFeeBps: row.transaction_fee_bps,
      escrowBalanceCents: row.escrow_balance_cents,
      serviceArea: row.service_area,
      verifiedAt: row.verified_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    };
  }
}
