import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError, ConflictError, ValidationError } from '../../lib/errors.js';
import { sendEmail, buildLowEscrowEmail } from '../../lib/email.js';
import type { CreateListingBody, UpdateListingBody } from './listings.schema.js';

export interface ListingServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
  sesFromEmail: string;
  appUrl: string;
}

interface ListingRow {
  id: string;
  company_id: string;
  service_name: string;
  service_category: string;
  description: string | null;
  reward_cents: number;
  qualified_bonus_cents: number;
  max_concurrent_sales: number;
  active_lead_count: number;
  escrow_reserved_cents: number;
  auto_replenish: boolean;
  status: string;
  created_at: Date;
  updated_at: Date;
}

// ─── ListingService ────────────────────────────────────────────────────────────

export class ListingService {
  constructor(private readonly deps: ListingServiceDeps) {}

  // ─── Create (draft) ─────────────────────────────────────────────────────────

  async create(companyId: string, body: CreateListingBody) {
    const result = await this.deps.db.query<ListingRow>(
      `INSERT INTO service_listings
         (company_id, service_name, service_category, description,
          reward_cents, qualified_bonus_cents, max_concurrent_sales, auto_replenish)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        companyId,
        body.serviceName,
        body.serviceCategory,
        body.description ?? null,
        body.rewardCents,
        body.qualifiedBonusCents ?? 0,
        body.maxConcurrentSales ?? 1,
        body.autoReplenish ?? false,
      ],
    );
    const row = result.rows[0];
    if (!row) throw new Error('Listing insert failed');
    return this.toResponse(row);
  }

  // ─── Get ────────────────────────────────────────────────────────────────────

  async get(companyId: string, listingId: string) {
    const result = await this.deps.db.query<ListingRow>(
      `SELECT * FROM service_listings
       WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL`,
      [listingId, companyId],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Listing');
    return this.toResponse(row);
  }

  // ─── List (own) ─────────────────────────────────────────────────────────────

  async list(companyId: string, opts: { status?: string; cursor?: string; limit: number }) {
    const limit = Math.min(opts.limit, 100);
    const params: unknown[] = [companyId, limit + 1];
    const clauses: string[] = ['company_id = $1', 'deleted_at IS NULL'];

    if (opts.status) {
      params.push(opts.status);
      clauses.push(`status = $${params.length}`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      clauses.push(`id < $${params.length}`);
    }

    const result = await this.deps.db.query<ListingRow>(
      `SELECT * FROM service_listings
       WHERE ${clauses.join(' AND ')}
       ORDER BY created_at DESC, id DESC
       LIMIT $2`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return {
      data: data.map((r) => this.toResponse(r)),
      cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  // ─── Update (draft only) ────────────────────────────────────────────────────

  async update(companyId: string, listingId: string, body: UpdateListingBody) {
    const existing = await this.deps.db.query<Pick<ListingRow, 'status'>>(
      'SELECT status FROM service_listings WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL',
      [listingId, companyId],
    );
    const listing = existing.rows[0];
    if (!listing) throw new NotFoundError('Listing');
    if (listing.status !== 'draft') {
      throw new ValidationError('Only draft listings can be edited. Pause the listing first.');
    }

    const fields: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    const textFields: [keyof UpdateListingBody, string][] = [
      ['serviceName', 'service_name'],
      ['serviceCategory', 'service_category'],
      ['description', 'description'],
    ];
    for (const [key, col] of textFields) {
      if (body[key] !== undefined) {
        fields.push(`${col} = $${idx++}`);
        values.push(body[key]);
      }
    }
    if (body.rewardCents !== undefined) {
      fields.push(`reward_cents = $${idx++}`);
      values.push(body.rewardCents);
    }
    if (body.qualifiedBonusCents !== undefined) {
      fields.push(`qualified_bonus_cents = $${idx++}`);
      values.push(body.qualifiedBonusCents);
    }
    if (body.maxConcurrentSales !== undefined) {
      fields.push(`max_concurrent_sales = $${idx++}`);
      values.push(body.maxConcurrentSales);
    }
    if (body.autoReplenish !== undefined) {
      fields.push(`auto_replenish = $${idx++}`);
      values.push(body.autoReplenish);
    }

    if (fields.length === 0) throw new ValidationError('No fields to update');

    values.push(listingId, companyId);
    const result = await this.deps.db.query<ListingRow>(
      `UPDATE service_listings SET ${fields.join(', ')}
       WHERE id = $${idx++} AND company_id = $${idx} AND deleted_at IS NULL
       RETURNING *`,
      values,
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError('Listing');
    return this.toResponse(row);
  }

  // ─── Activate ───────────────────────────────────────────────────────────────
  // Checks escrow sufficiency and reserves funds for all concurrent slots.

  async activate(companyId: string, listingId: string) {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      const listingResult = await client.query<ListingRow>(
        `SELECT * FROM service_listings
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [listingId, companyId],
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new NotFoundError('Listing');
      if (listing.status === 'active') {
        throw new ConflictError('Listing is already active');
      }
      if (listing.status === 'archived') {
        throw new ValidationError('Archived listings cannot be reactivated');
      }

      const companyResult = await client.query<{
        escrow_balance_cents: number;
        email: string | null;
      }>(
        `SELECT c.escrow_balance_cents, u.email
         FROM companies c
         LEFT JOIN users u ON u.company_id = c.id AND u.role = 'company_owner' AND u.deleted_at IS NULL
         WHERE c.id = $1
         LIMIT 1`,
        [companyId],
      );
      const company = companyResult.rows[0];
      if (!company) throw new NotFoundError('Company');

      const requiredCents = listing.reward_cents * listing.max_concurrent_sales;
      const alreadyReserved = listing.escrow_reserved_cents;
      const additionalNeeded = requiredCents - alreadyReserved;

      if (additionalNeeded > company.escrow_balance_cents) {
        throw new ValidationError(
          `Insufficient escrow balance. Need ${additionalNeeded} more cents. ` +
            `Deposit funds before activating this listing.`,
        );
      }

      // Deduct from available balance and reserve for listing
      await client.query(
        'UPDATE companies SET escrow_balance_cents = escrow_balance_cents - $1 WHERE id = $2',
        [additionalNeeded, companyId],
      );
      const balResult = await client.query<{ escrow_balance_cents: number }>(
        'SELECT escrow_balance_cents FROM companies WHERE id = $1',
        [companyId],
      );
      const newBalance = balResult.rows[0]?.escrow_balance_cents ?? 0;

      await client.query(
        `UPDATE service_listings
         SET status = 'active', escrow_reserved_cents = $1
         WHERE id = $2`,
        [requiredCents, listingId],
      );

      if (additionalNeeded > 0) {
        await client.query(
          `INSERT INTO escrow_transactions
             (company_id, type, amount_cents, balance_after_cents)
           VALUES ($1, 'reserve', $2, $3)`,
          [companyId, -additionalNeeded, newBalance],
        );
      }

      await client.query('COMMIT');

      // Low-escrow alert (fire-and-forget)
      if (company.email) {
        this.checkAndAlertLowEscrow(client, companyId, newBalance, company.email).catch(
          (err: unknown) => this.deps.log.error({ err }, 'Low escrow alert failed'),
        );
      }

      return this.get(companyId, listingId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Pause ──────────────────────────────────────────────────────────────────
  // Returns reserved-but-unused escrow to available balance.

  async pause(companyId: string, listingId: string) {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      const listingResult = await client.query<ListingRow>(
        `SELECT * FROM service_listings
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [listingId, companyId],
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new NotFoundError('Listing');
      if (listing.status !== 'active') {
        throw new ValidationError('Only active listings can be paused');
      }

      // Return unused reserved escrow (escrow_reserved_cents - funds committed to pending leads)
      const pendingResult = await client.query<{ total: string }>(
        `SELECT COALESCE(SUM(reward_cents), 0)::text AS total
         FROM leads WHERE listing_id = $1 AND status = 'pending'`,
        [listingId],
      );
      const pendingCommitted = parseInt(pendingResult.rows[0]?.total ?? '0', 10);
      const returnable = listing.escrow_reserved_cents - pendingCommitted;

      if (returnable > 0) {
        await client.query(
          'UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1 WHERE id = $2',
          [returnable, companyId],
        );
        const balResult = await client.query<{ escrow_balance_cents: number }>(
          'SELECT escrow_balance_cents FROM companies WHERE id = $1',
          [companyId],
        );
        const newBalance = balResult.rows[0]?.escrow_balance_cents ?? 0;
        await client.query(
          `INSERT INTO escrow_transactions (company_id, type, amount_cents, balance_after_cents)
           VALUES ($1, 'refund', $2, $3)`,
          [companyId, returnable, newBalance],
        );
      }

      await client.query(
        `UPDATE service_listings
         SET status = 'paused', escrow_reserved_cents = $1
         WHERE id = $2`,
        [pendingCommitted, listingId],
      );

      await client.query('COMMIT');
      return this.get(companyId, listingId);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Archive ────────────────────────────────────────────────────────────────

  async archive(companyId: string, listingId: string) {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      const listingResult = await client.query<ListingRow>(
        `SELECT * FROM service_listings
         WHERE id = $1 AND company_id = $2 AND deleted_at IS NULL
         FOR UPDATE`,
        [listingId, companyId],
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new NotFoundError('Listing');
      if (listing.status === 'archived') {
        throw new ConflictError('Listing is already archived');
      }

      const pendingResult = await client.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM leads
         WHERE listing_id = $1 AND status = 'pending'`,
        [listingId],
      );
      const pendingCount = parseInt(pendingResult.rows[0]?.count ?? '0', 10);
      if (pendingCount > 0) {
        throw new ValidationError(
          `Cannot archive: ${pendingCount} pending lead(s) must be resolved first`,
        );
      }

      if (listing.escrow_reserved_cents > 0) {
        await client.query(
          'UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1 WHERE id = $2',
          [listing.escrow_reserved_cents, companyId],
        );
        const balResult = await client.query<{ escrow_balance_cents: number }>(
          'SELECT escrow_balance_cents FROM companies WHERE id = $1',
          [companyId],
        );
        await client.query(
          `INSERT INTO escrow_transactions (company_id, type, amount_cents, balance_after_cents)
           VALUES ($1, 'refund', $2, $3)`,
          [companyId, listing.escrow_reserved_cents, balResult.rows[0]?.escrow_balance_cents ?? 0],
        );
      }

      await client.query(
        `UPDATE service_listings
         SET status = 'archived', escrow_reserved_cents = 0, deleted_at = NOW()
         WHERE id = $1`,
        [listingId],
      );

      await client.query('COMMIT');
      return { id: listingId, status: 'archived' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Search (across all active listings) ────────────────────────────────────

  async search(opts: { query: string; serviceArea?: string; cursor?: string; limit: number }) {
    const limit = Math.min(opts.limit, 50);
    const params: unknown[] = [opts.query, limit + 1];
    const clauses: string[] = [
      `sl.status = 'active'`,
      `sl.deleted_at IS NULL`,
      `sl.search_vector @@ plainto_tsquery('english', $1)`,
    ];

    if (opts.serviceArea) {
      params.push(opts.serviceArea);
      clauses.push(`$${params.length} = ANY(c.service_area)`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      clauses.push(`sl.id < $${params.length}`);
    }

    const result = await this.deps.db.query<{
      id: string;
      company_id: string;
      company_name: string;
      service_area: string[];
      service_name: string;
      service_category: string;
      description: string | null;
      reward_cents: number;
      qualified_bonus_cents: number;
      rank: number;
    }>(
      `SELECT sl.id, sl.company_id, c.name AS company_name, c.service_area,
              sl.service_name, sl.service_category, sl.description,
              sl.reward_cents, sl.qualified_bonus_cents,
              ts_rank(sl.search_vector, plainto_tsquery('english', $1)) AS rank
       FROM service_listings sl
       JOIN companies c ON c.id = sl.company_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY rank DESC, sl.id DESC
       LIMIT $2`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: data.map((r) => ({
        id: r.id,
        companyId: r.company_id,
        companyName: r.company_name,
        serviceArea: r.service_area,
        serviceName: r.service_name,
        serviceCategory: r.service_category,
        description: r.description,
        rewardCents: r.reward_cents,
        qualifiedBonusCents: r.qualified_bonus_cents,
        rank: r.rank,
      })),
      cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private async checkAndAlertLowEscrow(
    _client: PoolClient,
    companyId: string,
    balanceCents: number,
    ownerEmail: string,
  ): Promise<void> {
    const prefResult = await this.deps.db.query<{
      email_low_escrow: boolean;
      low_escrow_threshold_cents: number;
    }>(
      `SELECT np.email_low_escrow, np.low_escrow_threshold_cents
       FROM notification_preferences np
       JOIN users u ON u.id = np.user_id
       WHERE u.company_id = $1 AND u.role = 'company_owner'
       LIMIT 1`,
      [companyId],
    );
    const prefs = prefResult.rows[0];
    const threshold = prefs?.low_escrow_threshold_cents ?? 5000;
    if ((prefs?.email_low_escrow ?? true) && balanceCents < threshold) {
      sendEmail(
        buildLowEscrowEmail({
          recipientEmail: ownerEmail,
          balanceCents,
          thresholdCents: threshold,
          fromEmail: this.deps.sesFromEmail,
          appUrl: this.deps.appUrl,
        }),
      ).catch((err: unknown) => this.deps.log.error({ err }, 'Failed to send low escrow email'));
    }
  }

  private toResponse(row: ListingRow) {
    return {
      id: row.id,
      companyId: row.company_id,
      serviceName: row.service_name,
      serviceCategory: row.service_category,
      description: row.description,
      rewardCents: row.reward_cents,
      qualifiedBonusCents: row.qualified_bonus_cents,
      maxConcurrentSales: row.max_concurrent_sales,
      activeLeadCount: row.active_lead_count,
      escrowReservedCents: row.escrow_reserved_cents,
      autoReplenish: row.auto_replenish,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    };
  }
}
