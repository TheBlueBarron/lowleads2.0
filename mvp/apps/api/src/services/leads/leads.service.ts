import type { Pool, PoolClient } from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { NotFoundError, ConflictError, ValidationError, ForbiddenError } from '../../lib/errors.js';
import { encryptField, decryptField } from '../../lib/crypto.js';
import { sendEmail, buildNewLeadEmail, buildLeadResolvedEmail } from '../../lib/email.js';
import { MINIMUM_FEE_CENTS } from '@lowleads/shared-types';
import type { SubmitLeadBody, LeadsQuery } from './leads.schema.js';

export interface LeadServiceDeps {
  db: Pool;
  log: FastifyBaseLogger;
  kmsKeyId: string;
  sesFromEmail: string;
  appUrl: string;
}

interface LeadRow {
  id: string;
  listing_id: string;
  receiving_company_id: string;
  submitter_user_id: string;
  technician_id: string | null;
  customer_first_name: string;
  customer_last_initial: string;
  customer_phone_encrypted: string;
  customer_email_encrypted: string | null;
  notes_encrypted: string | null;
  customer_address_street_encrypted: string | null;
  customer_zip: string | null;
  status: string;
  reward_cents: number;
  qualified_bonus_cents: number;
  viewed_at: Date | null;
  resolved_at: Date | null;
  submitted_at: Date;
  created_at: Date;
  updated_at: Date;
}

/**
 * Split a net payout (reward − platform fee) 50/50 between an employee and their
 * employer. On an odd number of cents the company takes the extra cent, so the
 * two shares always sum exactly to the payout (no money created or lost).
 */
export function splitPayout(payoutCents: number): {
  technicianCents: number;
  companyCents: number;
} {
  const technicianCents = Math.floor(payoutCents / 2);
  return { technicianCents, companyCents: payoutCents - technicianCents };
}

// ─── LeadService ──────────────────────────────────────────────────────────────

export class LeadService {
  constructor(private readonly deps: LeadServiceDeps) {}

  // ─── Submit ─────────────────────────────────────────────────────────────────

  async submit(submitterUserId: string, submitterCompanyId: string, body: SubmitLeadBody) {
    // Encrypt PII before any DB work. Street address is encrypted like notes;
    // ZIP is stored in the clear so it can be matched against auction ZIPs.
    const [phoneEncrypted, emailEncrypted, notesEncrypted, addressEncrypted] = await Promise.all([
      encryptField(body.customerPhone, this.deps.kmsKeyId),
      body.customerEmail ? encryptField(body.customerEmail, this.deps.kmsKeyId) : null,
      body.notes ? encryptField(body.notes, this.deps.kmsKeyId) : null,
      body.customerAddressStreet
        ? encryptField(body.customerAddressStreet, this.deps.kmsKeyId)
        : null,
    ]);

    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      // Lock the listing row to prevent race on active_lead_count
      const listingResult = await client.query<{
        id: string;
        company_id: string;
        status: string;
        reward_cents: number;
        qualified_bonus_cents: number;
        max_concurrent_sales: number;
        active_lead_count: number;
      }>(
        `SELECT id, company_id, status, reward_cents, qualified_bonus_cents,
                max_concurrent_sales, active_lead_count
         FROM service_listings
         WHERE id = $1 AND deleted_at IS NULL
         FOR UPDATE`,
        [body.listingId],
      );
      const listing = listingResult.rows[0];
      if (!listing) throw new NotFoundError('Listing');
      if (listing.status !== 'active') {
        throw new ValidationError('This listing is not currently accepting leads');
      }
      if (listing.active_lead_count >= listing.max_concurrent_sales) {
        throw new ConflictError('This listing has reached its maximum concurrent pending leads');
      }

      // A company cannot submit leads to its own listing
      if (listing.company_id === submitterCompanyId) {
        throw new ForbiddenError('Cannot submit a lead to your own listing');
      }

      // Validate technician belongs to submitter's company if provided
      if (body.technicianId) {
        const techResult = await client.query<{ company_id: string }>(
          'SELECT company_id FROM technicians WHERE id = $1',
          [body.technicianId],
        );
        const tech = techResult.rows[0];
        if (!tech) throw new NotFoundError('Technician');
        if (tech.company_id !== submitterCompanyId) {
          throw new ForbiddenError('Technician does not belong to your company');
        }
      }

      // If no technician was named explicitly but the submitter is themselves an
      // employee (has a technician record), attribute the lead to them so it
      // shows in their stats and the reward split routes to them on a sale.
      let effectiveTechnicianId = body.technicianId ?? null;
      if (!effectiveTechnicianId) {
        const ownTech = await client.query<{ id: string }>(
          'SELECT id FROM technicians WHERE user_id = $1 AND company_id = $2',
          [submitterUserId, submitterCompanyId],
        );
        effectiveTechnicianId = ownTech.rows[0]?.id ?? null;
      }

      const leadResult = await client.query<LeadRow>(
        `INSERT INTO leads
           (listing_id, receiving_company_id, submitter_user_id, technician_id,
            customer_first_name, customer_last_initial,
            customer_phone_encrypted, customer_email_encrypted, notes_encrypted,
            customer_address_street_encrypted, customer_zip,
            reward_cents, qualified_bonus_cents)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         RETURNING *`,
        [
          body.listingId,
          listing.company_id,
          submitterUserId,
          effectiveTechnicianId,
          body.customerFirstName,
          body.customerLastInitial.toUpperCase(),
          phoneEncrypted,
          emailEncrypted,
          notesEncrypted,
          addressEncrypted,
          body.customerZip ?? null,
          listing.reward_cents,
          listing.qualified_bonus_cents,
        ],
      );
      const lead = leadResult.rows[0];
      if (!lead) throw new Error('Lead insert failed');

      // Increment listing active_lead_count
      await client.query(
        'UPDATE service_listings SET active_lead_count = active_lead_count + 1 WHERE id = $1',
        [body.listingId],
      );

      // Increment technician lead count if applicable
      if (effectiveTechnicianId) {
        await client.query(
          'UPDATE technicians SET total_leads_submitted = total_leads_submitted + 1 WHERE id = $1',
          [effectiveTechnicianId],
        );
      }

      await client.query('COMMIT');

      // Notify the receiving company owner (fire-and-forget)
      this.sendNewLeadNotification(client, listing.company_id, lead.id).catch((err: unknown) =>
        this.deps.log.error({ err }, 'New lead notification failed'),
      );

      return this.toSummary(lead);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── List ───────────────────────────────────────────────────────────────────

  async list(companyId: string, opts: LeadsQuery & { limit: number }) {
    const limit = Math.min(opts.limit, 100);
    const params: unknown[] = [companyId, limit + 1];
    const clauses: string[] = [];

    // Role filter: receiver sees leads coming in, submitter sees leads they sent
    if (opts.role === 'receiver') {
      clauses.push('l.receiving_company_id = $1');
    } else if (opts.role === 'submitter') {
      clauses.push(`l.submitter_user_id IN (SELECT id FROM users WHERE company_id = $1)`);
    } else {
      // Both by default
      clauses.push(
        `(l.receiving_company_id = $1 OR l.submitter_user_id IN (SELECT id FROM users WHERE company_id = $1))`,
      );
    }

    if (opts.status) {
      params.push(opts.status);
      clauses.push(`l.status = $${params.length}`);
    }
    if (opts.cursor) {
      params.push(opts.cursor);
      clauses.push(`l.id < $${params.length}`);
    }

    const result = await this.deps.db.query<LeadRow>(
      `SELECT l.id, l.listing_id, l.receiving_company_id, l.submitter_user_id, l.technician_id,
              l.customer_first_name, l.customer_last_initial,
              l.customer_phone_encrypted, l.customer_email_encrypted, l.notes_encrypted,
              l.status, l.reward_cents, l.qualified_bonus_cents,
              l.viewed_at, l.resolved_at, l.submitted_at, l.created_at, l.updated_at
       FROM leads l
       WHERE ${clauses.join(' AND ')}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT $2`,
      params,
    );

    const rows = result.rows;
    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;

    return {
      data: data.map((r) => this.toSummary(r)),
      cursor: hasMore ? (data[data.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  // ─── Get (with PII decryption for receiver) ─────────────────────────────────

  async get(companyId: string, leadId: string, isReceiver: boolean) {
    const result = await this.deps.db.query<LeadRow>(`SELECT * FROM leads WHERE id = $1`, [leadId]);
    const lead = result.rows[0];
    if (!lead) throw new NotFoundError('Lead');

    // Authorization: must be receiver or submitter's company
    const isSubmitter = await this.isSubmitterCompany(companyId, lead.submitter_user_id);
    const isReceiverOfLead = lead.receiving_company_id === companyId;
    if (!isReceiverOfLead && !isSubmitter) {
      throw new ForbiddenError('Access denied');
    }

    // Mark as viewed by receiver on first open
    if (isReceiverOfLead && !lead.viewed_at) {
      await this.deps.db.query('UPDATE leads SET viewed_at = NOW() WHERE id = $1', [leadId]);
      lead.viewed_at = new Date();
    }

    // Decrypt PII only for the receiver
    let customerPhone: string | null = null;
    let customerEmail: string | null = null;
    let notes: string | null = null;
    let customerAddressStreet: string | null = null;

    if (isReceiverOfLead || isReceiver) {
      [customerPhone, customerEmail, notes, customerAddressStreet] = await Promise.all([
        decryptField(lead.customer_phone_encrypted),
        lead.customer_email_encrypted ? decryptField(lead.customer_email_encrypted) : null,
        lead.notes_encrypted ? decryptField(lead.notes_encrypted) : null,
        lead.customer_address_street_encrypted
          ? decryptField(lead.customer_address_street_encrypted)
          : null,
      ]);
    }

    return {
      ...this.toSummary(lead),
      customerPhone,
      customerEmail,
      notes,
      customerAddressStreet,
    };
  }

  // ─── Refer: ranked company list for the submission company-selection step ───

  async referCompanies(submitterCompanyId: string, zip: string, categoryId: string, q?: string) {
    // Standing "Recommended" winner for this ZIP×category (most recent close).
    const winnerResult = await this.deps.db.query<{ winning_company_id: string }>(
      `SELECT winning_company_id FROM category_auctions
       WHERE zip_code = $1 AND category_id = $2 AND status = 'closed'
         AND winning_company_id IS NOT NULL
       ORDER BY period_month DESC
       LIMIT 1`,
      [zip, categoryId],
    );
    const winnerCompanyId = winnerResult.rows[0]?.winning_company_id ?? null;

    // Eligible listings (§5.4): active, in this category, not the submitter's own,
    // and not at concurrency cap — ineligible listings never appear in the list.
    const params: unknown[] = [categoryId, submitterCompanyId];
    let qClause = '';
    if (q) {
      params.push(`%${q}%`);
      qClause = `AND (l.service_name ILIKE $${params.length} OR c.name ILIKE $${params.length})`;
    }

    const result = await this.deps.db.query<{
      id: string;
      company_id: string;
      company_name: string;
      service_name: string;
      service_category: string;
      reward_cents: number;
      qualified_bonus_cents: number;
      sale_count: number;
      resolved_count: number;
    }>(
      `SELECT l.id, l.company_id, c.name AS company_name, l.service_name, l.service_category,
              l.reward_cents, l.qualified_bonus_cents,
              (SELECT COUNT(*) FROM leads x WHERE x.listing_id = l.id AND x.status = 'sale')::int
                AS sale_count,
              (SELECT COUNT(*) FROM leads x
                 WHERE x.listing_id = l.id
                   AND x.status IN ('sale', 'no_sale', 'not_qualified'))::int AS resolved_count
       FROM service_listings l
       JOIN companies c ON c.id = l.company_id
       WHERE l.category_id = $1
         AND l.status = 'active'
         AND l.deleted_at IS NULL
         AND l.company_id <> $2
         AND l.active_lead_count < l.max_concurrent_sales
         ${qClause}`,
      params,
    );

    const maxReward = Math.max(1, ...result.rows.map((r) => r.reward_cents));
    const ranked = result.rows
      .map((r) => {
        const closeRate = r.resolved_count > 0 ? r.sale_count / r.resolved_count : 0;
        // Existing ranking formula: reward (normalized) and close rate, 50/50.
        const score = (r.reward_cents / maxReward) * 0.5 + closeRate * 0.5;
        return {
          listingId: r.id,
          companyId: r.company_id,
          companyName: r.company_name,
          serviceName: r.service_name,
          serviceCategory: r.service_category,
          rewardCents: r.reward_cents,
          qualifiedBonusCents: r.qualified_bonus_cents,
          closeRate,
          score,
          recommended: false,
        };
      })
      .sort((a, b) => b.score - a.score);

    // Pin the Recommended winner to #1 — but only if it survived eligibility (§5.4).
    if (winnerCompanyId) {
      const idx = ranked.findIndex((x) => x.companyId === winnerCompanyId);
      if (idx >= 0) {
        const [winner] = ranked.splice(idx, 1);
        winner!.recommended = true;
        ranked.unshift(winner!);
      }
    }

    return { data: ranked, total: ranked.length };
  }

  // ─── Update Status ──────────────────────────────────────────────────────────

  async updateStatus(
    companyId: string,
    leadId: string,
    newStatus: 'not_qualified' | 'no_sale' | 'sale',
  ) {
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      const leadResult = await client.query<LeadRow>(
        `SELECT * FROM leads WHERE id = $1 FOR UPDATE`,
        [leadId],
      );
      const lead = leadResult.rows[0];
      if (!lead) throw new NotFoundError('Lead');
      if (lead.receiving_company_id !== companyId) {
        throw new ForbiddenError('Only the receiving company can update lead status');
      }
      if (lead.status !== 'pending') {
        throw new ConflictError(`Lead is already in terminal status: ${lead.status}`);
      }

      const companyResult = await client.query<{
        escrow_balance_cents: number;
        transaction_fee_bps: number;
      }>('SELECT escrow_balance_cents, transaction_fee_bps FROM companies WHERE id = $1', [
        companyId,
      ]);
      const company = companyResult.rows[0];
      if (!company) throw new NotFoundError('Company');

      if (newStatus === 'sale') {
        await this.processSaleEscrow(client, lead, company.transaction_fee_bps, companyId);
      } else {
        // no_sale or not_qualified — return reserved funds
        await this.processNoSaleEscrow(client, lead, companyId);
      }

      // Update lead status (DB trigger enforces terminal state immutability)
      await client.query(`UPDATE leads SET status = $1, resolved_at = NOW() WHERE id = $2`, [
        newStatus,
        leadId,
      ]);

      // Decrement listing active_lead_count
      await client.query(
        'UPDATE service_listings SET active_lead_count = active_lead_count - 1 WHERE id = $1',
        [lead.listing_id],
      );

      // Update technician counters. Earnings (total_earned_cents) are handled
      // inside processSaleEscrow, which credits the actual submitting employee
      // their share of the split — so we only track not_qualified here.
      if (lead.technician_id && newStatus === 'not_qualified') {
        await client.query(
          'UPDATE technicians SET not_qualified_count = not_qualified_count + 1 WHERE id = $1',
          [lead.technician_id],
        );
      }

      const updatedResult = await client.query<LeadRow>(`SELECT * FROM leads WHERE id = $1`, [
        leadId,
      ]);

      await client.query('COMMIT');

      // Notify submitter of resolution (fire-and-forget)
      this.sendLeadResolvedNotification(lead, newStatus).catch((err: unknown) =>
        this.deps.log.error({ err }, 'Lead resolved notification failed'),
      );

      const updated = updatedResult.rows[0];
      if (!updated) throw new NotFoundError('Lead');
      return this.toSummary(updated);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private calculateFee(rewardCents: number, feeBps: number): number {
    const fee = Math.floor((rewardCents * feeBps) / 10_000);
    return Math.max(fee, MINIMUM_FEE_CENTS);
  }

  private async processSaleEscrow(
    client: PoolClient,
    lead: LeadRow,
    feeBps: number,
    companyId: string,
  ): Promise<void> {
    const feeCents = this.calculateFee(lead.reward_cents, feeBps);
    const payoutCents = lead.reward_cents - feeCents;

    // The escrow_reserved_cents on the listing covered this lead's reward.
    // Deduct from listing's reserved amount.
    await client.query(
      `UPDATE service_listings
       SET escrow_reserved_cents = escrow_reserved_cents - $1
       WHERE id = $2`,
      [lead.reward_cents, lead.listing_id],
    );

    const balResult = await client.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [companyId],
    );
    const currentBalance = balResult.rows[0]?.escrow_balance_cents ?? 0;

    // FEE tx — platform revenue
    await client.query(
      `INSERT INTO escrow_transactions (company_id, lead_id, type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'fee', $3, $4)`,
      [companyId, lead.id, -feeCents, currentBalance],
    );

    // RELEASE tx (receiver side) — payout leaves the receiver's escrow toward the submitter
    await client.query(
      `INSERT INTO escrow_transactions (company_id, lead_id, type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'release', $3, $4)`,
      [companyId, lead.id, -payoutCents, currentBalance],
    );

    // Resolve the submitter and route the payout (platform-held-balance model —
    // money stays in the platform and is paid out manually on request).
    const submitterResult = await client.query<{ company_id: string | null; role: string }>(
      'SELECT company_id, role FROM users WHERE id = $1',
      [lead.submitter_user_id],
    );
    const submitter = submitterResult.rows[0];
    const submitterCompanyId = submitter?.company_id;
    if (!submitterCompanyId) {
      // Never silently drop a payout — fail the whole sale so it can be investigated.
      throw new NotFoundError('Submitter company for lead payout');
    }

    // If the submitter is an employee (role=technician), the net payout is split
    // 50/50 between the employee's own balance and their employer's. Otherwise
    // the submitting company keeps the full payout (unchanged behavior).
    let technicianId: string | null = null;
    if (submitter?.role === 'technician') {
      const techResult = await client.query<{ id: string }>(
        'SELECT id FROM technicians WHERE user_id = $1',
        [lead.submitter_user_id],
      );
      technicianId = techResult.rows[0]?.id ?? null;
    }

    if (technicianId) {
      const { technicianCents, companyCents } = splitPayout(payoutCents);

      // Employee's share → their own balance + a 'technician'-payee ledger row.
      const techBalResult = await client.query<{ escrow_balance_cents: number }>(
        `UPDATE technicians
         SET escrow_balance_cents = escrow_balance_cents + $1,
             total_earned_cents   = total_earned_cents + $1
         WHERE id = $2
         RETURNING escrow_balance_cents`,
        [technicianCents, technicianId],
      );
      const techBalance = techBalResult.rows[0]?.escrow_balance_cents ?? 0;
      await client.query(
        `INSERT INTO escrow_transactions
           (company_id, lead_id, type, amount_cents, balance_after_cents, payee_type, technician_id)
         VALUES ($1, $2, 'release', $3, $4, 'technician', $5)`,
        [submitterCompanyId, lead.id, technicianCents, techBalance, technicianId],
      );

      // Employer's share → company balance + a 'company'-payee ledger row.
      const compBalResult = await client.query<{ escrow_balance_cents: number }>(
        `UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1
         WHERE id = $2
         RETURNING escrow_balance_cents`,
        [companyCents, submitterCompanyId],
      );
      const compBalance = compBalResult.rows[0]?.escrow_balance_cents ?? 0;
      await client.query(
        `INSERT INTO escrow_transactions
           (company_id, lead_id, type, amount_cents, balance_after_cents, payee_type)
         VALUES ($1, $2, 'release', $3, $4, 'company')`,
        [submitterCompanyId, lead.id, companyCents, compBalance],
      );
    } else {
      const submitterBalResult = await client.query<{ escrow_balance_cents: number }>(
        `UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1
         WHERE id = $2
         RETURNING escrow_balance_cents`,
        [payoutCents, submitterCompanyId],
      );
      const submitterBalance = submitterBalResult.rows[0]?.escrow_balance_cents ?? 0;

      // RELEASE tx (submitter side) — full payout lands in the company balance.
      await client.query(
        `INSERT INTO escrow_transactions
           (company_id, lead_id, type, amount_cents, balance_after_cents, payee_type)
         VALUES ($1, $2, 'release', $3, $4, 'company')`,
        [submitterCompanyId, lead.id, payoutCents, submitterBalance],
      );
    }
  }

  private async processNoSaleEscrow(
    client: PoolClient,
    lead: LeadRow,
    companyId: string,
  ): Promise<void> {
    // Return the reserved reward_cents to the company's available balance
    await client.query(
      'UPDATE companies SET escrow_balance_cents = escrow_balance_cents + $1 WHERE id = $2',
      [lead.reward_cents, companyId],
    );
    await client.query(
      `UPDATE service_listings
       SET escrow_reserved_cents = escrow_reserved_cents - $1
       WHERE id = $2`,
      [lead.reward_cents, lead.listing_id],
    );
    const balResult = await client.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [companyId],
    );
    await client.query(
      `INSERT INTO escrow_transactions (company_id, lead_id, type, amount_cents, balance_after_cents)
       VALUES ($1, $2, 'refund', $3, $4)`,
      [companyId, lead.id, lead.reward_cents, balResult.rows[0]?.escrow_balance_cents ?? 0],
    );
  }

  private async isSubmitterCompany(companyId: string, submitterUserId: string): Promise<boolean> {
    const result = await this.deps.db.query<{ company_id: string }>(
      'SELECT company_id FROM users WHERE id = $1 AND deleted_at IS NULL',
      [submitterUserId],
    );
    return result.rows[0]?.company_id === companyId;
  }

  private async sendNewLeadNotification(
    _client: PoolClient,
    receivingCompanyId: string,
    _leadId: string,
  ): Promise<void> {
    const prefResult = await this.deps.db.query<{
      email: string;
      email_new_lead: boolean;
    }>(
      `SELECT u.email, COALESCE(np.email_new_lead, TRUE) AS email_new_lead
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.company_id = $1 AND u.role = 'company_owner' AND u.deleted_at IS NULL
       LIMIT 1`,
      [receivingCompanyId],
    );
    const prefs = prefResult.rows[0];
    if (!prefs || !prefs.email_new_lead) return;

    sendEmail(
      buildNewLeadEmail({
        recipientEmail: prefs.email,
        fromEmail: this.deps.sesFromEmail,
        appUrl: this.deps.appUrl,
      }),
    ).catch((err: unknown) => this.deps.log.error({ err }, 'Failed to send new lead email'));
  }

  private async sendLeadResolvedNotification(lead: LeadRow, status: string): Promise<void> {
    const prefResult = await this.deps.db.query<{
      email: string;
      email_lead_resolved: boolean;
    }>(
      `SELECT u.email, COALESCE(np.email_lead_resolved, TRUE) AS email_lead_resolved
       FROM users u
       LEFT JOIN notification_preferences np ON np.user_id = u.id
       WHERE u.id = $1 AND u.deleted_at IS NULL`,
      [lead.submitter_user_id],
    );
    const prefs = prefResult.rows[0];
    if (!prefs || !prefs.email_lead_resolved) return;

    sendEmail(
      buildLeadResolvedEmail({
        recipientEmail: prefs.email,
        fromEmail: this.deps.sesFromEmail,
        status,
        rewardCents: lead.reward_cents,
        appUrl: this.deps.appUrl,
      }),
    ).catch((err: unknown) => this.deps.log.error({ err }, 'Failed to send lead resolved email'));
  }

  private toSummary(row: LeadRow) {
    return {
      id: row.id,
      listingId: row.listing_id,
      receivingCompanyId: row.receiving_company_id,
      submitterUserId: row.submitter_user_id,
      technicianId: row.technician_id,
      customerFirstName: row.customer_first_name,
      customerLastInitial: row.customer_last_initial,
      customerZip: row.customer_zip,
      status: row.status,
      rewardCents: row.reward_cents,
      qualifiedBonusCents: row.qualified_bonus_cents,
      viewedAt: row.viewed_at?.toISOString() ?? null,
      resolvedAt: row.resolved_at?.toISOString() ?? null,
      submittedAt: row.submitted_at.toISOString(),
      createdAt: row.created_at.toISOString(),
    };
  }
}
