/**
 * Integration tests for lead routes.
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
  jwtAccessSecret: 'lead-test-access-secret-32-chars!',
  jwtRefreshHmacSecret: 'lead-test-refresh-hmac',
  jwtEmailSecret: 'lead-test-email-secret',
  jwtPasswordResetSecret: 'lead-test-password-reset',
  cookieSecret: 'lead-test-cookie-secret-32-chars!',
  kmsKeyId: 'test-kms-key',
  sesFromEmail: 'noreply@lowleads.com',
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

async function seedCompany(slug: string, escrow = 100000) {
  const pool = getPrimaryPool();
  const comp = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, subscription_tier, transaction_fee_bps, escrow_balance_cents)
     VALUES ($1, $2, 'pro', 600, $3) RETURNING id`,
    [`${slug} Co`, slug, escrow],
  );
  const companyId = comp.rows[0]!.id;
  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, company_id, email_verified_at)
     VALUES ($1, 'hash', 'company_owner', $2, NOW()) RETURNING id`,
    [`${slug}@test.example.com`, companyId],
  );
  const userId = user.rows[0]!.id;
  return { companyId, userId, token: signToken(userId, companyId) };
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
  // TRUNCATE on append-only tables (escrow_transactions, audit_log) bypasses
  // their no-DELETE triggers; regular DELETE for the rest.
  const pool = getPrimaryPool();
  await pool.query(`
    DELETE FROM leads;
    TRUNCATE escrow_transactions RESTART IDENTITY CASCADE;
    DELETE FROM service_listings;
    DELETE FROM technicians;
    DELETE FROM users WHERE email LIKE '%@test.example.com';
    DELETE FROM companies WHERE slug LIKE 'lead-%';
    TRUNCATE audit_log RESTART IDENTITY CASCADE;
  `);
});

// ─── SUBMIT LEAD ─────────────────────────────────────────────────────────────

describe('POST /v1/leads', () => {
  it('submits a lead to an active listing from another company', async () => {
    const receiver = await seedCompany('lead-recv');
    const submitter = await seedCompany('lead-subm');
    const listingId = await seedActiveListing(receiver.companyId, 5000);

    const res = await request
      .post('/v1/leads')
      .set('Authorization', `Bearer ${submitter.token}`)
      .send({
        listingId,
        customerFirstName: 'Alice',
        customerLastInitial: 'B',
        customerPhone: '5551234567',
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('pending');
    expect(res.body.customerFirstName).toBe('Alice');
    expect(res.body.rewardCents).toBe(5000);
  });

  it('rejects self-referral (cannot submit to own listing)', async () => {
    const company = await seedCompany('lead-self');
    const listingId = await seedActiveListing(company.companyId, 3000);

    const res = await request
      .post('/v1/leads')
      .set('Authorization', `Bearer ${company.token}`)
      .send({
        listingId,
        customerFirstName: 'Bob',
        customerLastInitial: 'C',
        customerPhone: '5559876543',
      });

    expect(res.status).toBe(403);
  });

  it('rejects submission to inactive listing', async () => {
    const receiver = await seedCompany('lead-inactive-recv');
    const submitter = await seedCompany('lead-inactive-subm');
    const pool = getPrimaryPool();

    const listRes = await pool.query<{ id: string }>(
      `INSERT INTO service_listings (company_id, service_name, service_category, reward_cents, status)
       VALUES ($1, 'Draft Listing', 'plumbing', 3000, 'draft') RETURNING id`,
      [receiver.companyId],
    );

    const res = await request
      .post('/v1/leads')
      .set('Authorization', `Bearer ${submitter.token}`)
      .send({
        listingId: listRes.rows[0]!.id,
        customerFirstName: 'Carol',
        customerLastInitial: 'D',
        customerPhone: '5550001111',
      });

    expect(res.status).toBe(400);
  });

  it('enforces max_concurrent_sales limit', async () => {
    const receiver = await seedCompany('lead-max-recv');
    const pool = getPrimaryPool();
    const subm1 = await seedCompany('lead-max-s1');
    await seedCompany('lead-max-s2');

    // Listing with max_concurrent_sales = 1 and active_lead_count already at 1
    const listRes = await pool.query<{ id: string }>(
      `INSERT INTO service_listings
         (company_id, service_name, service_category, reward_cents, status,
          escrow_reserved_cents, max_concurrent_sales, active_lead_count)
       VALUES ($1, 'Full', 'hvac', 2000, 'active', 2000, 1, 1) RETURNING id`,
      [receiver.companyId],
    );

    const res = await request.post('/v1/leads').set('Authorization', `Bearer ${subm1.token}`).send({
      listingId: listRes.rows[0]!.id,
      customerFirstName: 'Dave',
      customerLastInitial: 'E',
      customerPhone: '5552223333',
    });

    expect(res.status).toBe(409);
  });
});

// ─── UPDATE STATUS ────────────────────────────────────────────────────────────

describe('PATCH /v1/leads/:id/status', () => {
  it('marks lead as sale and records escrow transactions', async () => {
    const receiver = await seedCompany('lead-sale-recv', 50000);
    const submitter = await seedCompany('lead-sale-subm');
    const pool = getPrimaryPool();
    const listingId = await seedActiveListing(receiver.companyId, 5000);

    // Insert lead directly
    const leadRes = await pool.query<{ id: string }>(
      `INSERT INTO leads
         (listing_id, receiving_company_id, submitter_user_id,
          customer_first_name, customer_last_initial,
          customer_phone_encrypted, reward_cents, qualified_bonus_cents)
       VALUES ($1, $2, $3, 'Eve', 'F', 'encrypted_placeholder', 5000, 0)
       RETURNING id`,
      [listingId, receiver.companyId, submitter.userId],
    );
    const leadId = leadRes.rows[0]!.id;

    const res = await request
      .patch(`/v1/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ status: 'sale' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('sale');

    // Verify escrow transactions were recorded
    const txns = await pool.query(
      `SELECT type FROM escrow_transactions
       WHERE company_id = $1 AND lead_id = $2`,
      [receiver.companyId, leadId],
    );
    const types = txns.rows.map((r: { type: string }) => r.type);
    expect(types).toContain('fee');
    expect(types).toContain('release');
  });

  it('marks lead as no_sale and refunds escrow', async () => {
    const receiver = await seedCompany('lead-nosale-recv', 50000);
    const submitter = await seedCompany('lead-nosale-subm');
    const pool = getPrimaryPool();
    const listingId = await seedActiveListing(receiver.companyId, 4000);

    const leadRes = await pool.query<{ id: string }>(
      `INSERT INTO leads
         (listing_id, receiving_company_id, submitter_user_id,
          customer_first_name, customer_last_initial,
          customer_phone_encrypted, reward_cents, qualified_bonus_cents)
       VALUES ($1, $2, $3, 'Frank', 'G', 'enc_ph', 4000, 0)
       RETURNING id`,
      [listingId, receiver.companyId, submitter.userId],
    );
    const leadId = leadRes.rows[0]!.id;

    const res = await request
      .patch(`/v1/leads/${leadId}/status`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ status: 'no_sale' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('no_sale');

    const txn = await pool.query(
      `SELECT type, amount_cents FROM escrow_transactions
       WHERE company_id = $1 AND lead_id = $2`,
      [receiver.companyId, leadId],
    );
    expect(txn.rows[0]!.type).toBe('refund');
    expect(txn.rows[0]!.amount_cents).toBe(4000);
  });

  it('rejects status update from non-receiver company', async () => {
    const receiver = await seedCompany('lead-auth-recv', 50000);
    const submitter = await seedCompany('lead-auth-subm');
    const intruder = await seedCompany('lead-auth-intruder');
    const pool = getPrimaryPool();
    const listingId = await seedActiveListing(receiver.companyId, 3000);

    const leadRes = await pool.query<{ id: string }>(
      `INSERT INTO leads
         (listing_id, receiving_company_id, submitter_user_id,
          customer_first_name, customer_last_initial,
          customer_phone_encrypted, reward_cents, qualified_bonus_cents)
       VALUES ($1, $2, $3, 'Grace', 'H', 'enc_ph', 3000, 0) RETURNING id`,
      [listingId, receiver.companyId, submitter.userId],
    );

    const res = await request
      .patch(`/v1/leads/${leadRes.rows[0]!.id}/status`)
      .set('Authorization', `Bearer ${intruder.token}`)
      .send({ status: 'sale' });

    expect(res.status).toBe(403);
  });

  it('rejects duplicate status update on terminal lead', async () => {
    const receiver = await seedCompany('lead-term-recv', 50000);
    const submitter = await seedCompany('lead-term-subm');
    const pool = getPrimaryPool();
    const listingId = await seedActiveListing(receiver.companyId, 3000);

    const leadRes = await pool.query<{ id: string }>(
      `INSERT INTO leads
         (listing_id, receiving_company_id, submitter_user_id,
          customer_first_name, customer_last_initial,
          customer_phone_encrypted, reward_cents, qualified_bonus_cents, status)
       VALUES ($1, $2, $3, 'Henry', 'I', 'enc_ph', 3000, 0, 'sale') RETURNING id`,
      [listingId, receiver.companyId, submitter.userId],
    );

    const res = await request
      .patch(`/v1/leads/${leadRes.rows[0]!.id}/status`)
      .set('Authorization', `Bearer ${receiver.token}`)
      .send({ status: 'no_sale' });

    expect(res.status).toBe(409);
  });
});
