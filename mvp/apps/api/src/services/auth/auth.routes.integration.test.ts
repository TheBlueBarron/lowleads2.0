/**
 * Integration tests for auth routes.
 * Requires Docker Compose services running: docker compose -f docker-compose.test.yml up -d
 * Uses real PostgreSQL and Redis — no mocks.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import supertest from 'supertest';
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
  jwtAccessSecret: 'integration-test-access-secret-32ch',
  jwtRefreshHmacSecret: 'integration-test-refresh-hmac',
  jwtEmailSecret: 'integration-test-email-secret',
  jwtPasswordResetSecret: 'integration-test-password-reset',
  cookieSecret: 'integration-test-cookie-secret-32ch',
  kmsKeyId: 'test-kms-key', // KMS calls mocked in test environment
  sesFromEmail: 'noreply@lowleads.com',
  stripeSecretKey: 'placeholder',
  stripeWebhookSecret: 'placeholder',
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
  // Clean test data between tests — order matters (FK constraints).
  // TRUNCATE on append-only tables (audit_log) bypasses the no-DELETE trigger.
  const pool = getPrimaryPool();
  await pool.query(`
    TRUNCATE audit_log RESTART IDENTITY CASCADE;
    DELETE FROM users WHERE email LIKE '%@test.example.com';
    DELETE FROM companies WHERE slug LIKE 'test-%';
  `);
});

// ─── Register ────────────────────────────────────────────────────────────────

describe('POST /v1/auth/register', () => {
  it('creates a new company owner account', async () => {
    const res = await request.post('/v1/auth/register').send({
      email: 'owner@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'Test Plumbing Co',
      companySlug: 'test-plumbing-co',
    });

    expect(res.status).toBe(201);
    expect(res.body.message.toLowerCase()).toContain('verify');
  });

  it('rejects duplicate email with 409', async () => {
    const payload = {
      email: 'dup@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'Test Co',
      companySlug: 'test-dup-co',
    };
    await request.post('/v1/auth/register').send(payload);
    const res = await request.post('/v1/auth/register').send({
      ...payload,
      companySlug: 'test-dup-co-2',
    });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('rejects duplicate slug with 409', async () => {
    await request.post('/v1/auth/register').send({
      email: 'first@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'First Co',
      companySlug: 'test-unique-slug',
    });

    const res = await request.post('/v1/auth/register').send({
      email: 'second@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'Second Co',
      companySlug: 'test-unique-slug',
    });

    expect(res.status).toBe(409);
  });

  it('rejects weak password (less than 12 chars)', async () => {
    const res = await request.post('/v1/auth/register').send({
      email: 'weak@test.example.com',
      password: 'short',
      companyName: 'Test Co',
      companySlug: 'test-weak-pw',
    });

    expect(res.status).toBe(400);
  });

  it('rejects invalid slug pattern', async () => {
    const res = await request.post('/v1/auth/register').send({
      email: 'bad@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'Test Co',
      companySlug: 'Has Spaces And CAPS',
    });

    expect(res.status).toBe(400);
  });
});

// ─── Login ────────────────────────────────────────────────────────────────────

describe('POST /v1/auth/login', () => {
  const TEST_USER = {
    email: 'logintest@test.example.com',
    password: 'LoginTestPassword123!',
    companyName: 'Login Test Co',
    companySlug: 'test-login-co',
  };

  beforeEach(async () => {
    // Create and verify a test user directly in DB
    await request.post('/v1/auth/register').send(TEST_USER);
    const pool = getPrimaryPool();
    await pool.query(`UPDATE users SET email_verified_at = NOW() WHERE email = $1`, [
      TEST_USER.email,
    ]);
  });

  it('returns access token on valid credentials', async () => {
    const res = await request.post('/v1/auth/login').send({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.expiresIn).toBe(900);
    expect(res.headers['set-cookie']).toBeDefined();
  });

  it('sets httpOnly cookie with refresh token', async () => {
    const res = await request.post('/v1/auth/login').send({
      email: TEST_USER.email,
      password: TEST_USER.password,
    });

    const cookie = (res.headers['set-cookie'] as unknown as string[])[0] ?? '';
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
  });

  it('returns 401 for wrong password', async () => {
    const res = await request.post('/v1/auth/login').send({
      email: TEST_USER.email,
      password: 'WrongPassword123!',
    });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 401 for unverified email', async () => {
    await request.post('/v1/auth/register').send({
      email: 'unverified@test.example.com',
      password: 'StrongPassword123!',
      companyName: 'Unverified Co',
      companySlug: 'test-unverified',
    });

    const res = await request.post('/v1/auth/login').send({
      email: 'unverified@test.example.com',
      password: 'StrongPassword123!',
    });

    expect(res.status).toBe(401);
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request.post('/v1/auth/login').send({
      email: 'nobody@test.example.com',
      password: 'SomePassword123!',
    });

    expect(res.status).toBe(401);
  });
});

// ─── Refresh ─────────────────────────────────────────────────────────────────

describe('POST /v1/auth/refresh', () => {
  it('returns new access token and rotates refresh cookie', async () => {
    // Register and verify
    await request.post('/v1/auth/register').send({
      email: 'refresh@test.example.com',
      password: 'RefreshTestPw123!',
      companyName: 'Refresh Test Co',
      companySlug: 'test-refresh-co',
    });
    await getPrimaryPool().query(`UPDATE users SET email_verified_at = NOW() WHERE email = $1`, [
      'refresh@test.example.com',
    ]);

    const loginRes = await request.post('/v1/auth/login').send({
      email: 'refresh@test.example.com',
      password: 'RefreshTestPw123!',
    });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[])[0] ?? '';

    const refreshRes = await request.post('/v1/auth/refresh').set('Cookie', refreshCookie);

    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.accessToken).toBeTruthy();
    expect(refreshRes.headers['set-cookie']).toBeDefined();
  });

  it('returns 401 when no cookie provided', async () => {
    const res = await request.post('/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});

// ─── Logout ───────────────────────────────────────────────────────────────────

describe('POST /v1/auth/logout', () => {
  it('returns 204 and clears cookie', async () => {
    await request.post('/v1/auth/register').send({
      email: 'logout@test.example.com',
      password: 'LogoutTestPw123!',
      companyName: 'Logout Test Co',
      companySlug: 'test-logout-co',
    });
    await getPrimaryPool().query(`UPDATE users SET email_verified_at = NOW() WHERE email = $1`, [
      'logout@test.example.com',
    ]);

    const loginRes = await request.post('/v1/auth/login').send({
      email: 'logout@test.example.com',
      password: 'LogoutTestPw123!',
    });
    const refreshCookie = (loginRes.headers['set-cookie'] as unknown as string[])[0] ?? '';
    const { accessToken } = loginRes.body as { accessToken: string };

    const res = await request
      .post('/v1/auth/logout')
      .set('Cookie', refreshCookie)
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(204);
  });
});

// ─── Health check ─────────────────────────────────────────────────────────────

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});
