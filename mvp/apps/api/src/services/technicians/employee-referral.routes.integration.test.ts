/**
 * Integration tests for the employee (technician) referral feature:
 *  - employee self-registration via company join code
 *  - 50/50 reward split when an employee submits a closed lead
 *  - unchanged single payout when a company owner submits
 *  - manual payout (process_payout) for both payee types
 *
 * Requires: docker compose -f docker-compose.test.yml up -d
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { getPrimaryPool } from '@lowleads/db';

const TEST_DB_URL =
  process.env['TEST_DATABASE_URL'] ??
  'postgresql://lowleads_test:lowleads_test@localhost:5433/lowleads_test';
const TEST_REDIS_URL = process.env['TEST_REDIS_URL'] ?? 'redis://localhost:6380';

const TEST_SECRETS = {
  databaseUrl: TEST_DB_URL,
  databaseReplicaUrl: undefined,
  redisUrl: TEST_REDIS_URL,
  jwtAccessSecret: 'emp-test-access-secret-32-chars!!',
  jwtRefreshHmacSecret: 'emp-test-refresh-hmac',
  jwtEmailSecret: 'emp-test-email-secret',
  jwtPasswordResetSecret: 'emp-test-password-reset',
  cookieSecret: 'emp-test-cookie-secret-32-chars!!',
  kmsKeyId: 'test-kms-key',
  sesFromEmail: 'noreply@lowleads.com',
  resendApiKey: 'test-resend-key',
  stripeSecretKey: 'sk_test_placeholder',
  stripeWebhookSecret: 'whsec_placeholder',
  twilioAccountSid: 'placeholder',
  twilioAuthToken: 'placeholder',
};

let app: FastifyInstance;
let request: ReturnType<typeof supertest>;

function signToken(
  sub: string,
  companyId: string,
  role: 'company_owner' | 'technician' = 'company_owner',
): string {
  return jwt.sign({ sub, role, companyId, mfaVerified: false }, TEST_SECRETS.jwtAccessSecret, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

async function seedCompany(slug: string, joinCode: string, escrow = 100000) {
  const pool = getPrimaryPool();
  const comp = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, subscription_tier, transaction_fee_bps, escrow_balance_cents, join_code)
     VALUES ($1, $2, 'pro', 600, $3, $4) RETURNING id`,
    [`${slug} Co`, slug, escrow, joinCode],
  );
  const companyId = comp.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, company_id, email_verified_at)
     VALUES ($1, 'hash', 'company_owner', $2, NOW()) RETURNING id`,
    [`${slug}-owner@test.example.com`, companyId],
  );
  const userId = user.rows[0]!.id;
  return { companyId, userId, token: signToken(userId, companyId) };
}

async function seedEmployee(companyId: string, slug: string) {
  const pool = getPrimaryPool();
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, company_id, email_verified_at)
     VALUES ($1, 'hash', 'technician', $2, NOW()) RETURNING id`,
    [`${slug}-emp@test.example.com`, companyId],
  );
  const userId = user.rows[0]!.id;
  const tech = await pool.query<{ id: string }>(
    `INSERT INTO technicians (user_id, company_id, display_name)
     VALUES ($1, $2, $3) RETURNING id`,
    [userId, companyId, `${slug} Employee`],
  );
  return {
    userId,
    technicianId: tech.rows[0]!.id,
    token: signToken(userId, companyId, 'technician'),
  };
}

async function seedActiveListing(companyId: string, rewardCents = 5000) {
  const pool = getPrimaryPool();
  const res = await pool.query<{ id: string }>(
    `INSERT INTO service_listings
       (company_id, service_name, service_category, reward_cents, status,
        escrow_reserved_cents, max_concurrent_sales)
     VALUES ($1, 'Plumbing', 'plumbing', $2, 'active', $2, 1) RETURNING id`,
    [companyId, rewardCents],
  );
  return res.rows[0]!.id;
}

async function insertPendingLead(
  listingId: string,
  receivingCompanyId: string,
  submitterUserId: string,
  technicianId: string | null,
  rewardCents: number,
) {
  const pool = getPrimaryPool();
  const leadRes = await pool.query<{ id: string }>(
    `INSERT INTO leads
       (listing_id, receiving_company_id, submitter_user_id, technician_id,
        customer_first_name, customer_last_initial,
        customer_phone_encrypted, reward_cents, qualified_bonus_cents)
     VALUES ($1, $2, $3, $4, 'Eve', 'F', 'encrypted_placeholder', $5, 0)
     RETURNING id`,
    [listingId, receivingCompanyId, submitterUserId, technicianId, rewardCents],
  );
  await pool.query('UPDATE service_listings SET active_lead_count = 1 WHERE id = $1', [listingId]);
  return leadRes.rows[0]!.id;
}

beforeAll(async () => {
  app = await buildApp({
    ...TEST_SECRETS,
    port: 0,
    host: '127.0.0.1',
    appUrl: 'http://localhost:3000',
    logLevel: 'silent',
  });
  await app.ready();
  request = supertest(app.server);
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Order matters (FK constraints). escrow_transactions now references technicians,
  // so it must be cleared before technicians are deleted.
  const pool = getPrimaryPool();
  await pool.query(`
    TRUNCATE escrow_transactions RESTART IDENTITY CASCADE;
    DELETE FROM leads;
    DELETE FROM service_listings;
    DELETE FROM technicians;
    TRUNCATE audit_log RESTART IDENTITY CASCADE;
    DELETE FROM users WHERE email LIKE '%@test.example.com' OR email LIKE '%@example.com';
    DELETE FROM companies WHERE slug LIKE 'emp-%';
  `);
});

// ─── EMPLOYEE SELF-REGISTRATION ───────────────────────────────────────────────

describe('POST /v1/auth/register-technician', () => {
  it('registers an employee against a valid join code', async () => {
    const employer = await seedCompany('emp-reg-ok', 'JOINOK01');

    const res = await request.post('/v1/auth/register-technician').send({
      email: 'new-hire@test.example.com',
      password: 'SuperSecret123!',
      displayName: 'New Hire',
      companyJoinCode: 'joinok01', // lowercase — must be normalized
    });

    expect(res.status).toBe(201);

    const pool = getPrimaryPool();
    const user = await pool.query<{ id: string; role: string; company_id: string }>(
      `SELECT id, role, company_id FROM users WHERE email = 'new-hire@test.example.com'`,
    );
    expect(user.rows[0]!.role).toBe('technician');
    expect(user.rows[0]!.company_id).toBe(employer.companyId);

    const tech = await pool.query(`SELECT id FROM technicians WHERE user_id = $1`, [
      user.rows[0]!.id,
    ]);
    expect(tech.rows).toHaveLength(1);
  });

  it('rejects an invalid join code cleanly', async () => {
    await seedCompany('emp-reg-bad', 'JOINBAD1');

    const res = await request.post('/v1/auth/register-technician').send({
      email: 'no-company@test.example.com',
      password: 'SuperSecret123!',
      displayName: 'Orphan',
      companyJoinCode: 'NOPE9999',
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/join code/i);

    // No user should have been created
    const pool = getPrimaryPool();
    const user = await pool.query(
      `SELECT id FROM users WHERE email = 'no-company@test.example.com'`,
    );
    expect(user.rows).toHaveLength(0);
  });

  it('rejects a duplicate email', async () => {
    await seedCompany('emp-reg-dup', 'JOINDUP1');

    const body = {
      email: 'dup@test.example.com',
      password: 'SuperSecret123!',
      displayName: 'Dup',
      companyJoinCode: 'JOINDUP1',
    };
    const first = await request.post('/v1/auth/register-technician').send(body);
    expect(first.status).toBe(201);

    const second = await request.post('/v1/auth/register-technician').send(body);
    expect(second.status).toBe(409);
  });
});

// ─── REWARD SPLIT ON SALE ─────────────────────────────────────────────────────

describe('PATCH /v1/leads/:id/status — reward split', () => {
  it('splits the payout 50/50 when an employee is the submitter', async () => {
    const receiver = await seedCompany('emp-split-recv', 'JOINSPR1', 50000);
    const employer = await seedCompany('emp-split-empr', 'JOINSPE1', 100000);
    const employee = await seedEmployee(employer.companyId, 'emp-split');
    const listingId = await seedActiveListing(receiver.companyId, 5000);

    const leadId = await insertPendingLead(
      listingId,
      receiver.companyId,
      employee.userId,
      employee.technicianId,
      5000,
    );

    const res = await request
      .patch(`/v1/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ status: 'sale' });

    expect(res.status).toBe(200);

    // reward 5000 @ 600 bps → fee 300, payout 4700 → split 2350 / 2350
    const feeCents = 300;
    const payoutCents = 4700;
    const technicianCents = 2350;
    const companyCents = 2350;

    const pool = getPrimaryPool();

    // Employee balance credited their half
    const tech = await pool.query<{ escrow_balance_cents: number; total_earned_cents: number }>(
      'SELECT escrow_balance_cents, total_earned_cents FROM technicians WHERE id = $1',
      [employee.technicianId],
    );
    expect(tech.rows[0]!.escrow_balance_cents).toBe(technicianCents);
    expect(tech.rows[0]!.total_earned_cents).toBe(technicianCents);

    // Employer company balance credited the other half
    const employerCompany = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [employer.companyId],
    );
    expect(employerCompany.rows[0]!.escrow_balance_cents).toBe(100000 + companyCents);

    // Two distinct submitter-side release rows referencing the same lead
    const techRow = await pool.query<{ amount_cents: number; technician_id: string }>(
      `SELECT amount_cents, technician_id FROM escrow_transactions
       WHERE lead_id = $1 AND payee_type = 'technician'`,
      [leadId],
    );
    expect(techRow.rows).toHaveLength(1);
    expect(techRow.rows[0]!.amount_cents).toBe(technicianCents);
    expect(techRow.rows[0]!.technician_id).toBe(employee.technicianId);

    const companyRow = await pool.query<{ amount_cents: number }>(
      `SELECT amount_cents FROM escrow_transactions
       WHERE lead_id = $1 AND payee_type = 'company' AND type = 'release'
         AND company_id = $2`,
      [leadId, employer.companyId],
    );
    expect(companyRow.rows).toHaveLength(1);
    expect(companyRow.rows[0]!.amount_cents).toBe(companyCents);

    // Conservation: employee + employer shares equal the net payout, and
    // fee + payout equals the reward.
    expect(technicianCents + companyCents).toBe(payoutCents);
    expect(feeCents + payoutCents).toBe(5000);
  });

  it('pays the full payout to the company when an owner is the submitter (unchanged)', async () => {
    const receiver = await seedCompany('emp-owner-recv', 'JOINOWR1', 50000);
    const submitter = await seedCompany('emp-owner-subm', 'JOINOWS1', 100000);
    const listingId = await seedActiveListing(receiver.companyId, 5000);

    // Submitter is the company owner (no technician_id on the lead)
    const leadId = await insertPendingLead(
      listingId,
      receiver.companyId,
      submitter.userId,
      null,
      5000,
    );

    const res = await request
      .patch(`/v1/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ status: 'sale' });

    expect(res.status).toBe(200);

    const pool = getPrimaryPool();
    const payoutCents = 4700;

    const submitterCompany = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [submitter.companyId],
    );
    expect(submitterCompany.rows[0]!.escrow_balance_cents).toBe(100000 + payoutCents);

    // Exactly one submitter-side release row, payee_type company, no technician rows
    const releaseRows = await pool.query<{ amount_cents: number; payee_type: string }>(
      `SELECT amount_cents, payee_type FROM escrow_transactions
       WHERE lead_id = $1 AND type = 'release' AND company_id = $2`,
      [leadId, submitter.companyId],
    );
    expect(releaseRows.rows).toHaveLength(1);
    expect(releaseRows.rows[0]!.payee_type).toBe('company');
    expect(releaseRows.rows[0]!.amount_cents).toBe(payoutCents);

    const techRows = await pool.query(
      `SELECT id FROM escrow_transactions WHERE lead_id = $1 AND payee_type = 'technician'`,
      [leadId],
    );
    expect(techRows.rows).toHaveLength(0);
  });
});

// ─── MANUAL PAYOUT (process_payout) ───────────────────────────────────────────

describe('process_payout()', () => {
  it('debits a technician balance and writes a withdrawal ledger row', async () => {
    const employer = await seedCompany('emp-payout-tech', 'JOINPT01', 100000);
    const employee = await seedEmployee(employer.companyId, 'emp-payout');
    const pool = getPrimaryPool();
    await pool.query('UPDATE technicians SET escrow_balance_cents = 5000 WHERE id = $1', [
      employee.technicianId,
    ]);

    // Use FROM process_payout(...) (single evaluation) — NOT (process_payout(...)).*,
    // which re-runs the volatile function once per output column.
    const res = await pool.query<{ amount_cents: number; balance_after_cents: number }>(
      `SELECT amount_cents, balance_after_cents
       FROM process_payout('technician'::escrow_payee_type, $1::uuid, $2::int, $3)`,
      [employee.technicianId, 2000, 'check-1001'],
    );
    expect(res.rows[0]!.amount_cents).toBe(-2000);
    expect(res.rows[0]!.balance_after_cents).toBe(3000);

    const tech = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM technicians WHERE id = $1',
      [employee.technicianId],
    );
    expect(tech.rows[0]!.escrow_balance_cents).toBe(3000);

    const row = await pool.query<{ type: string; payout_reference: string; payee_type: string }>(
      `SELECT type, payout_reference, payee_type FROM escrow_transactions
       WHERE technician_id = $1 AND type = 'withdrawal'`,
      [employee.technicianId],
    );
    expect(row.rows[0]!.type).toBe('withdrawal');
    expect(row.rows[0]!.payee_type).toBe('technician');
    expect(row.rows[0]!.payout_reference).toBe('check-1001');
  });

  it('debits a company balance and writes a withdrawal ledger row', async () => {
    const company = await seedCompany('emp-payout-co', 'JOINPC01', 8000);
    const pool = getPrimaryPool();

    await pool.query(`SELECT process_payout('company'::escrow_payee_type, $1::uuid, $2::int, $3)`, [
      company.companyId,
      5000,
      'wire-77',
    ]);

    const co = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [company.companyId],
    );
    expect(co.rows[0]!.escrow_balance_cents).toBe(3000);

    const row = await pool.query<{ amount_cents: number; payee_type: string }>(
      `SELECT amount_cents, payee_type FROM escrow_transactions
       WHERE company_id = $1 AND type = 'withdrawal'`,
      [company.companyId],
    );
    expect(row.rows[0]!.amount_cents).toBe(-5000);
    expect(row.rows[0]!.payee_type).toBe('company');
  });

  it('refuses to overdraw a balance', async () => {
    const company = await seedCompany('emp-payout-over', 'JOINPO01', 1000);
    const pool = getPrimaryPool();

    await expect(
      pool.query(`SELECT process_payout('company'::escrow_payee_type, $1::uuid, $2::int, $3)`, [
        company.companyId,
        5000,
        'too-much',
      ]),
    ).rejects.toThrow(/insufficient/i);

    // Balance untouched
    const co = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [company.companyId],
    );
    expect(co.rows[0]!.escrow_balance_cents).toBe(1000);
  });
});

// ─── JOIN CODE REGENERATION ───────────────────────────────────────────────────

describe('POST /v1/companies/me/join-code/regenerate', () => {
  it('issues a new join code and invalidates the old one', async () => {
    const company = await seedCompany('emp-regen', 'JOINRGN1');

    const res = await request
      .post('/v1/companies/me/join-code/regenerate')
      .set('Authorization', `Bearer ${company.token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.joinCode).toBe('string');
    expect(res.body.joinCode).not.toBe('JOINRGN1');

    // Old code no longer resolves
    const stale = await request.post('/v1/auth/register-technician').send({
      email: 'stale@test.example.com',
      password: 'SuperSecret123!',
      displayName: 'Stale',
      companyJoinCode: 'JOINRGN1',
    });
    expect(stale.status).toBe(400);
  });
});
