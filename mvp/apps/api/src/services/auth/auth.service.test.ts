import { describe, it, expect, jest } from '@jest/globals';
import type { Pool, PoolClient, QueryResult } from 'pg';
import type Redis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import { AuthService } from './auth.service.js';
import * as cryptoLib from '../../lib/crypto.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeLogger(): FastifyBaseLogger {
  return {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    fatal: jest.fn(),
    child: jest.fn(),
    level: 'silent',
    silent: jest.fn(),
  } as unknown as FastifyBaseLogger;
}

function makePoolClient(overrides: Partial<PoolClient> = {}): PoolClient {
  return {
    query: jest.fn<() => Promise<QueryResult>>().mockResolvedValue({
      rows: [],
      command: '',
      rowCount: 0,
      oid: 0,
      fields: [],
    } as unknown as QueryResult),
    release: jest.fn(),
    ...overrides,
  } as unknown as PoolClient;
}

function makePool(queryResult: { rows: unknown[] } = { rows: [] }): Pool {
  const client = makePoolClient();
  return {
    query: jest.fn<() => Promise<QueryResult>>().mockResolvedValue({
      rows: queryResult.rows,
      command: '',
      rowCount: queryResult.rows.length,
      oid: 0,
      fields: [],
    } as unknown as QueryResult),
    connect: jest.fn<() => Promise<PoolClient>>().mockResolvedValue(client),
  } as unknown as Pool;
}

function makeRedis(): Redis {
  return {
    get: jest.fn<() => Promise<string | null>>().mockResolvedValue(null),
    set: jest.fn<() => Promise<'OK'>>().mockResolvedValue('OK'),
    setex: jest.fn<() => Promise<'OK'>>().mockResolvedValue('OK'),
    del: jest.fn<() => Promise<number>>().mockResolvedValue(1),
    incr: jest.fn<() => Promise<number>>().mockResolvedValue(1),
    expire: jest.fn<() => Promise<number>>().mockResolvedValue(1),
    smembers: jest.fn<() => Promise<string[]>>().mockResolvedValue([]),
    sadd: jest.fn<() => Promise<number>>().mockResolvedValue(1),
  } as unknown as Redis;
}

function makeService(poolOverride?: Pool, redisOverride?: Redis): AuthService {
  return new AuthService({
    db: poolOverride ?? makePool(),
    redis: redisOverride ?? makeRedis(),
    log: makeLogger(),
    jwtAccessSecret: 'test-access-secret-32-chars-minimum!!',
    jwtRefreshHmacSecret: 'test-refresh-hmac-secret',
    jwtEmailSecret: 'test-email-secret',
    jwtPasswordResetSecret: 'test-password-reset-secret',
    kmsKeyId: 'test-kms-key-id',
    sesFromEmail: 'noreply@lowleads.com',
    appUrl: 'http://localhost:3000',
  });
}

// ─── Crypto unit tests (100% coverage required) ────────────────────────────────

describe('crypto utilities', () => {
  describe('hashPassword / verifyPassword', () => {
    it('produces an Argon2id hash', async () => {
      const hash = await cryptoLib.hashPassword('correct-horse-battery-staple!');
      expect(hash).toMatch(/^\$argon2id\$/);
    });

    it('verifies the correct password', async () => {
      const hash = await cryptoLib.hashPassword('my-secret-password-123');
      expect(await cryptoLib.verifyPassword(hash, 'my-secret-password-123')).toBe(true);
    });

    it('rejects wrong password', async () => {
      const hash = await cryptoLib.hashPassword('my-secret-password-123');
      expect(await cryptoLib.verifyPassword(hash, 'wrong-password')).toBe(false);
    });

    it('rejects empty string', async () => {
      const hash = await cryptoLib.hashPassword('my-secret-password-123');
      expect(await cryptoLib.verifyPassword(hash, '')).toBe(false);
    });
  });

  describe('hashSecret / verifySecret', () => {
    it('produces a valid Argon2id hash for refresh tokens', async () => {
      const secret = 'random_refresh_token_value';
      const hash = await cryptoLib.hashSecret(secret);
      expect(await cryptoLib.verifySecret(hash, secret)).toBe(true);
    });

    it('rejects wrong value', async () => {
      const hash = await cryptoLib.hashSecret('correct_value');
      expect(await cryptoLib.verifySecret(hash, 'wrong_value')).toBe(false);
    });
  });

  describe('generateRefreshToken / parseRefreshToken', () => {
    it('generates a token with family and value', () => {
      const { tokenFamily, tokenValue, fullToken } = cryptoLib.generateRefreshToken();
      expect(tokenFamily).toBeTruthy();
      expect(tokenValue).toBeTruthy();
      expect(fullToken).toBe(`${tokenFamily}:${tokenValue}`);
    });

    it('parses back correctly', () => {
      const { tokenFamily, tokenValue, fullToken } = cryptoLib.generateRefreshToken();
      const parsed = cryptoLib.parseRefreshToken(fullToken);
      expect(parsed.tokenFamily).toBe(tokenFamily);
      expect(parsed.tokenValue).toBe(tokenValue);
    });

    it('throws on malformed token', () => {
      expect(() => cryptoLib.parseRefreshToken('no-colon-here')).toThrow();
    });
  });

  describe('generateBackupCodes / hashBackupCodes / verifyBackupCode', () => {
    it('generates 8 codes by default', () => {
      const codes = cryptoLib.generateBackupCodes();
      expect(codes).toHaveLength(8);
    });

    it('generates codes of 10 hex characters', () => {
      const codes = cryptoLib.generateBackupCodes(8);
      for (const code of codes) {
        expect(code).toMatch(/^[0-9A-F]{10}$/);
      }
    });

    it('hashes and verifies a backup code', async () => {
      const codes = cryptoLib.generateBackupCodes(2);
      const hashes = await cryptoLib.hashBackupCodes(codes);
      const index = await cryptoLib.verifyBackupCode(codes[0]!, hashes);
      expect(index).toBe(0);
    });

    it('returns null for invalid backup code', async () => {
      const codes = cryptoLib.generateBackupCodes(2);
      const hashes = await cryptoLib.hashBackupCodes(codes);
      const index = await cryptoLib.verifyBackupCode('INVALIDCODE', hashes);
      expect(index).toBeNull();
    });

    it('ignores already-consumed codes (empty hash string)', async () => {
      const codes = cryptoLib.generateBackupCodes(2);
      const hashes = await cryptoLib.hashBackupCodes(codes);
      hashes[0] = '';
      const index = await cryptoLib.verifyBackupCode(codes[0]!, hashes);
      expect(index).toBeNull();
    });
  });

  describe('computeDeviceFingerprint', () => {
    it('produces consistent output for same inputs', () => {
      const fp1 = cryptoLib.computeDeviceFingerprint('Mozilla/5.0', '192.168.1.1', 'secret');
      const fp2 = cryptoLib.computeDeviceFingerprint('Mozilla/5.0', '192.168.1.1', 'secret');
      expect(fp1).toBe(fp2);
    });

    it('produces different output for different IPs', () => {
      const fp1 = cryptoLib.computeDeviceFingerprint('Mozilla/5.0', '192.168.1.1', 'secret');
      const fp2 = cryptoLib.computeDeviceFingerprint('Mozilla/5.0', '10.0.0.1', 'secret');
      expect(fp1).not.toBe(fp2);
    });
  });
});

// ─── AuthService unit tests ───────────────────────────────────────────────────

describe('AuthService', () => {
  describe('register', () => {
    it('throws ConflictError when email already exists', async () => {
      const pool = makePool({ rows: [{ id: 'existing-id' }] });
      const service = makeService(pool);

      await expect(
        service.register({
          email: 'duplicate@example.com',
          password: 'ValidPassword123!',
          companyName: 'Test Co',
          companySlug: 'test-co',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });

    it('rejects when slug is already taken', async () => {
      const pool = {
        query: jest
          .fn<() => Promise<QueryResult>>()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 } as unknown as QueryResult) // email check
          .mockResolvedValueOnce({
            rows: [{ id: 'existing' }],
            rowCount: 1,
          } as unknown as QueryResult), // slug check
        connect: jest.fn<() => Promise<PoolClient>>().mockResolvedValue(makePoolClient()),
      } as unknown as Pool;

      const service = makeService(pool);
      await expect(
        service.register({
          email: 'new@example.com',
          password: 'ValidPassword123!',
          companyName: 'Test Co',
          companySlug: 'taken-slug',
        }),
      ).rejects.toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('login', () => {
    it('throws AuthenticationError for non-existent user', async () => {
      const pool = makePool({ rows: [] });
      const redis = makeRedis();
      (redis.incr as jest.MockedFunction<typeof redis.incr>).mockResolvedValue(1);

      const service = makeService(pool, redis);
      await expect(
        service.login({
          email: 'ghost@example.com',
          password: 'any',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    });

    it('throws TooManyRequestsError when account is locked', async () => {
      const lockedUntil = new Date(Date.now() + 60_000);
      const pool = makePool({
        rows: [
          {
            id: 'user-1',
            email: 'locked@example.com',
            email_verified_at: new Date(),
            password_hash: '$argon2id$v=19$m=65536,t=3,p=4$fake',
            mfa_secret: null,
            mfa_backup_codes: null,
            mfa_enabled: false,
            role: 'company_owner',
            company_id: 'company-1',
            last_login_at: null,
            login_attempts: 5,
            locked_until: lockedUntil,
          },
        ],
      });
      const redis = makeRedis();
      (redis.incr as jest.MockedFunction<typeof redis.incr>).mockResolvedValue(1);

      const service = makeService(pool, redis);
      await expect(
        service.login({
          email: 'locked@example.com',
          password: 'any',
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('throws TooManyRequestsError when IP is blocked', async () => {
      const redis = makeRedis();
      (redis.get as jest.MockedFunction<typeof redis.get>).mockResolvedValue('1'); // IP blocked

      const service = makeService(undefined, redis);
      await expect(
        service.login({
          email: 'user@example.com',
          password: 'any',
          ipAddress: '1.2.3.4',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    it('requires MFA token when MFA is enabled', async () => {
      const pool = makePool({
        rows: [
          {
            id: 'user-1',
            email: 'mfa@example.com',
            email_verified_at: new Date(),
            password_hash: await cryptoLib.hashPassword('GoodPassword123!'),
            mfa_secret: 'encrypted-secret',
            mfa_backup_codes: null,
            mfa_enabled: true,
            role: 'company_owner',
            company_id: 'company-1',
            last_login_at: null,
            login_attempts: 0,
            locked_until: null,
          },
        ],
      });
      const redis = makeRedis();
      (redis.incr as jest.MockedFunction<typeof redis.incr>).mockResolvedValue(1);

      const service = makeService(pool, redis);
      await expect(
        service.login({
          email: 'mfa@example.com',
          password: 'GoodPassword123!',
          // No mfaToken provided
          ipAddress: '127.0.0.1',
          userAgent: 'test',
        }),
      ).rejects.toMatchObject({ code: 'UNAUTHORIZED', message: 'MFA token required' });
    });
  });

  describe('refresh', () => {
    it('throws on missing token family in Redis', async () => {
      const redis = makeRedis();
      (redis.get as jest.MockedFunction<typeof redis.get>).mockResolvedValue(null);

      const service = makeService(undefined, redis);
      const { fullToken } = cryptoLib.generateRefreshToken();

      await expect(service.refresh(fullToken)).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });

    it('throws on malformed token format', async () => {
      const service = makeService();
      await expect(service.refresh('no-colon-format')).rejects.toMatchObject({
        code: 'UNAUTHORIZED',
      });
    });
  });

  describe('logout', () => {
    it('deletes the refresh token from Redis', async () => {
      const redis = makeRedis();
      const service = makeService(undefined, redis);
      const { fullToken, tokenFamily } = cryptoLib.generateRefreshToken();

      await service.logout(fullToken);

      expect(redis.del).toHaveBeenCalledWith(`rt:${tokenFamily}`);
    });

    it('does not throw on invalid token format', async () => {
      const service = makeService();
      await expect(service.logout('invalid-token')).resolves.toBeUndefined();
    });
  });

  describe('requestPasswordReset', () => {
    it('does not reveal whether user exists (silent on missing email)', async () => {
      const pool = makePool({ rows: [] });
      const service = makeService(pool);

      await expect(service.requestPasswordReset('ghost@example.com')).resolves.toBeUndefined();
    });
  });

  describe('verifyEmail', () => {
    it('rejects invalid token', async () => {
      const service = makeService();
      await expect(service.verifyEmail('not-a-valid-jwt')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('setupMfa', () => {
    it('throws NotFoundError for non-existent user', async () => {
      const pool = makePool({ rows: [] });
      const service = makeService(pool);

      // Mock KMS — not called because user lookup fails first
      await expect(service.setupMfa('non-existent-uuid')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('throws ConflictError if MFA already enabled', async () => {
      const pool = makePool({
        rows: [{ id: 'user-1', email: 'test@example.com', mfa_enabled: true }],
      });
      const service = makeService(pool);

      await expect(service.setupMfa('user-1')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('verifyMfaSetup', () => {
    it('throws if MFA already enabled', async () => {
      const pool = makePool({
        rows: [{ id: 'user-1', mfa_secret: 'enc-secret', mfa_enabled: true }],
      });
      const service = makeService(pool);

      await expect(service.verifyMfaSetup('user-1', '123456')).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    });

    it('throws if no secret stored (setup not called first)', async () => {
      const pool = makePool({
        rows: [{ id: 'user-1', mfa_secret: null, mfa_enabled: false }],
      });
      const service = makeService(pool);

      await expect(service.verifyMfaSetup('user-1', '123456')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });

  describe('resetPassword', () => {
    it('rejects invalid JWT', async () => {
      const service = makeService();
      await expect(service.resetPassword('not-a-jwt', 'NewPassword123!')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
      });
    });
  });
});
