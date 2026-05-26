/**
 * Integration tests for listing routes.
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
  jwtAccessSecret: 'listing-test-access-secret-32chars',
  jwtRefreshHmacSecret: 'listing-test-refresh-hmac',
  jwtEmailSecret: 'listing-test-email-secret',
  jwtPasswordResetSecret: 'listing-test-password-reset',
  cookieSecret: 'listing-test-cookie-secret-32chars',
  kmsKeyId: 'test-kms-key',
  sesFromEmail: 'noreply@lowleads.com',
  stripeSecretKey: 'sk_test_placeholder',
  stripeWebhookSecret: 'whsec_placeholder',
  twilioAccountSid: 'placeholder',
  twilioAuthToken: 'placeholder',
};

let app: FastifyInstance;
let request: ReturnType<typeof supertest>;

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
  // Clean every test-affected table so a stale row from another test file
  // can't block FK-dependent cleanup here. Order matters (FK constraints).
  // TRUNCATE on append-only tables bypasses their no-DELETE triggers.
  const pool = getPrimaryPool();
  await pool.query(`
    TRUNCATE escrow_transactions RESTART IDENTITY CASCADE;
    DELETE FROM leads;
    DELETE FROM service_listings;
    DELETE FROM technicians;
    TRUNCATE audit_log RESTART IDENTITY CASCADE;
    DELETE FROM users WHERE email LIKE '%@test.example.com' OR email LIKE '%@example.com';
    DELETE FROM companies WHERE slug LIKE '%-test-%' OR slug = 'listing-test-co' OR slug LIKE 'test-%' OR slug LIKE 'lead-%';
  `);
});

// ─── Helper ──────────────────────────────────────────────────────────────────

function signToken(sub: string, companyId: string, role = 'company_owner'): string {
  return jwt.sign({ sub, role, companyId, mfaVerified: false }, TEST_SECRETS.jwtAccessSecret, {
    algorithm: 'HS256',
    expiresIn: '15m',
  });
}

async function seedCompany(slug: string, escrowCents = 50000) {
  const pool = getPrimaryPool();
  const comp = await pool.query<{ id: string }>(
    `INSERT INTO companies (name, slug, subscription_tier, transaction_fee_bps, escrow_balance_cents)
     VALUES ($1, $2, 'pro', 600, $3) RETURNING id`,
    [`${slug} Co`, slug, escrowCents],
  );
  const companyId = comp.rows[0]!.id;

  const user = await pool.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, role, company_id, email_verified_at)
     VALUES ($1, 'hash', 'company_owner', $2, NOW()) RETURNING id`,
    [`${slug}@test.example.com`, companyId],
  );
  const userId = user.rows[0]!.id;
  const token = signToken(userId, companyId);
  return { companyId, userId, token };
}

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('POST /v1/listings', () => {
  it('creates a draft listing', async () => {
    const { token } = await seedCompany('create-lst');

    const res = await request.post('/v1/listings').set('Authorization', `Bearer ${token}`).send({
      serviceName: 'HVAC Installation',
      serviceCategory: 'hvac',
      rewardCents: 5000,
    });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('draft');
    expect(res.body.rewardCents).toBe(5000);
    expect(res.body.serviceCategory).toBe('hvac');
  });

  it('rejects reward below minimum ($1)', async () => {
    const { token } = await seedCompany('min-reward-lst');

    const res = await request
      .post('/v1/listings')
      .set('Authorization', `Bearer ${token}`)
      .send({ serviceName: 'Test', serviceCategory: 'test', rewardCents: 50 });

    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request.post('/v1/listings').send({
      serviceName: 'Test',
      serviceCategory: 'test',
      rewardCents: 500,
    });
    expect(res.status).toBe(401);
  });
});

// ─── LIST ─────────────────────────────────────────────────────────────────────

describe('GET /v1/listings', () => {
  it('lists own listings', async () => {
    const { companyId, token } = await seedCompany('list-lst');
    const pool = getPrimaryPool();

    await pool.query(
      `INSERT INTO service_listings (company_id, service_name, service_category, reward_cents)
       VALUES ($1, 'Test Listing', 'plumbing', 2000)`,
      [companyId],
    );

    const res = await request.get('/v1/listings').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].serviceName).toBe('Test Listing');
  });
});

// ─── ACTIVATE ────────────────────────────────────────────────────────────────

describe('POST /v1/listings/:id/activate', () => {
  it('activates a draft listing and reserves escrow', async () => {
    const { companyId, token } = await seedCompany('activate-lst', 10000);
    const pool = getPrimaryPool();

    const listResult = await pool.query<{ id: string }>(
      `INSERT INTO service_listings (company_id, service_name, service_category, reward_cents, max_concurrent_sales)
       VALUES ($1, 'HVAC', 'hvac', 2000, 2) RETURNING id`,
      [companyId],
    );
    const listingId = listResult.rows[0]!.id;

    const res = await request
      .post(`/v1/listings/${listingId}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
    expect(res.body.escrowReservedCents).toBe(4000); // 2000 × 2

    // Verify escrow was deducted from company balance
    const comp = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [companyId],
    );
    expect(comp.rows[0]!.escrow_balance_cents).toBe(6000); // 10000 - 4000
  });

  it('rejects activation when insufficient escrow', async () => {
    const { companyId, token } = await seedCompany('insuff-escrow', 100);
    const pool = getPrimaryPool();

    const listResult = await pool.query<{ id: string }>(
      `INSERT INTO service_listings (company_id, service_name, service_category, reward_cents)
       VALUES ($1, 'Expensive', 'hvac', 5000) RETURNING id`,
      [companyId],
    );

    const res = await request
      .post(`/v1/listings/${listResult.rows[0]!.id}/activate`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain('Insufficient escrow');
  });
});

// ─── PAUSE ───────────────────────────────────────────────────────────────────

describe('POST /v1/listings/:id/pause', () => {
  it('pauses an active listing and returns escrow', async () => {
    const { companyId, token } = await seedCompany('pause-lst', 10000);
    const pool = getPrimaryPool();

    const listResult = await pool.query<{ id: string }>(
      `INSERT INTO service_listings
         (company_id, service_name, service_category, reward_cents, status, escrow_reserved_cents)
       VALUES ($1, 'Pauseable', 'plumbing', 3000, 'active', 3000) RETURNING id`,
      [companyId],
    );

    // Deduct from company balance to simulate prior activation
    await pool.query(
      'UPDATE companies SET escrow_balance_cents = escrow_balance_cents - 3000 WHERE id = $1',
      [companyId],
    );

    const res = await request
      .post(`/v1/listings/${listResult.rows[0]!.id}/pause`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('paused');

    const comp = await pool.query<{ escrow_balance_cents: number }>(
      'SELECT escrow_balance_cents FROM companies WHERE id = $1',
      [companyId],
    );
    expect(comp.rows[0]!.escrow_balance_cents).toBe(10000); // 7000 + 3000 returned
  });
});

// ─── SEARCH ──────────────────────────────────────────────────────────────────

describe('GET /v1/listings/search', () => {
  it('returns full-text matched listings', async () => {
    const { companyId, token } = await seedCompany('search-lst');
    const pool = getPrimaryPool();

    // Update service_area for the company
    await pool.query(
      `UPDATE companies SET service_area = ARRAY['Phoenix', '85001'] WHERE id = $1`,
      [companyId],
    );

    await pool.query(
      `INSERT INTO service_listings (company_id, service_name, service_category, reward_cents, status)
       VALUES ($1, 'Plumbing Repair', 'plumbing', 5000, 'active')`,
      [companyId],
    );

    const res = await request
      .get('/v1/listings/search?q=plumbing')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.data[0].serviceName).toBe('Plumbing Repair');
  });
});
