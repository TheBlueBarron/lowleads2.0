import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { authenticator } from 'otplib';
import * as QRCode from 'qrcode';
import type { Pool, PoolClient } from 'pg';
import type Redis from 'ioredis';
import type { FastifyBaseLogger } from 'fastify';
import type { UserRole, AccessTokenPayload } from '@lowleads/shared-types';
import {
  hashPassword,
  verifyPassword,
  hashSecret,
  verifySecret,
  generateRefreshToken,
  parseRefreshToken,
  generateJti,
  computeDeviceFingerprint,
  generateBackupCodes,
  hashBackupCodes,
  verifyBackupCode,
  encryptField,
  decryptField,
} from '../../lib/crypto.js';
import {
  sendEmail,
  buildVerificationEmail,
  buildPasswordResetEmail,
  buildNewDeviceAlertEmail,
} from '../../lib/email.js';
import {
  AuthenticationError,
  ConflictError,
  NotFoundError,
  TooManyRequestsError,
  ValidationError,
  AppError,
} from '../../lib/errors.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60; // 15 minutes
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const EMAIL_TOKEN_TTL_SECONDS = 24 * 60 * 60; // 24 hours
const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 hour

const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 15 * 60; // 15 minutes
const IP_RATE_WINDOW_SECONDS = 10 * 60; // 10 minutes
const IP_RATE_MAX_ATTEMPTS = 20;
const IP_BLOCK_DURATION_SECONDS = 60 * 60; // 1 hour

const REDIS_KEYS = {
  refreshToken: (family: string) => `rt:${family}`,
  emailJti: (jti: string) => `email_jti:${jti}`,
  passwordResetJti: (jti: string) => `pr_jti:${jti}`,
  ipLoginAttempts: (ip: string) => `ip_login:${ip}`,
  ipBlocked: (ip: string) => `ip_blocked:${ip}`,
  deviceFingerprint: (userId: string) => `device:${userId}`,
} as const;

// ─── Dependencies interface ───────────────────────────────────────────────────

export interface AuthServiceDeps {
  db: Pool;
  redis: Redis;
  log: FastifyBaseLogger;
  jwtAccessSecret: string;
  jwtRefreshHmacSecret: string;
  jwtEmailSecret: string;
  jwtPasswordResetSecret: string;
  kmsKeyId: string;
  sesFromEmail: string;
  appUrl: string;
}

// ─── DB row types (internal) ──────────────────────────────────────────────────

interface UserRow {
  id: string;
  email: string;
  email_verified_at: Date | null;
  password_hash: string;
  mfa_secret: string | null;
  mfa_backup_codes: string[] | null;
  mfa_enabled: boolean;
  role: UserRole;
  company_id: string;
  last_login_at: Date | null;
  login_attempts: number;
  locked_until: Date | null;
}

// ─── AuthService ──────────────────────────────────────────────────────────────

export class AuthService {
  constructor(private readonly deps: AuthServiceDeps) {}

  // ─── Register ──────────────────────────────────────────────────────────────

  async register(params: {
    email: string;
    password: string;
    companyName: string;
    companySlug: string;
  }): Promise<{ message: string }> {
    const { email, password, companyName, companySlug } = params;

    // Check email uniqueness before hashing (fast path)
    const existing = await this.deps.db.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()],
    );
    if (existing.rows.length > 0) {
      throw new ConflictError('An account with this email already exists');
    }

    // Check slug uniqueness
    const slugExists = await this.deps.db.query<{ id: string }>(
      'SELECT id FROM companies WHERE slug = $1 AND deleted_at IS NULL',
      [companySlug],
    );
    if (slugExists.rows.length > 0) {
      throw new ConflictError('This company slug is already taken');
    }

    const passwordHash = await hashPassword(password);

    // Transaction: create company then user atomically
    const client = await this.deps.db.connect();
    try {
      await client.query('BEGIN');

      const companyResult = await client.query<{ id: string }>(
        `INSERT INTO companies (name, slug, subscription_tier, transaction_fee_bps, escrow_balance_cents)
         VALUES ($1, $2, 'free', 800, 0)
         RETURNING id`,
        [companyName, companySlug],
      );
      const company = companyResult.rows[0];
      if (!company) throw new Error('Company insert failed');

      const userResult = await client.query<{ id: string }>(
        `INSERT INTO users (email, password_hash, role, company_id)
         VALUES ($1, $2, 'company_owner', $3)
         RETURNING id`,
        [email.toLowerCase(), passwordHash, company.id],
      );
      const user = userResult.rows[0];
      if (!user) throw new Error('User insert failed');

      await this.writeAuditLog(client, {
        eventType: 'user.registered',
        actorUserId: user.id,
        actorIp: null,
        resourceType: 'user',
        resourceId: user.id,
        payload: { companyId: company.id, role: 'company_owner' },
      });

      await client.query('COMMIT');

      // Send verification email (fire-and-forget — don't block registration response)
      const token = this.signEmailVerificationToken(user.id, email);
      const verificationLink = `${this.deps.appUrl}/verify-email?token=${token}`;
      sendEmail(
        buildVerificationEmail({
          recipientEmail: email,
          verificationLink,
          fromEmail: this.deps.sesFromEmail,
        }),
      ).catch((err: unknown) => {
        this.deps.log.error({ err }, 'Failed to send verification email');
      });

      return { message: 'Registration successful. Check your email to verify your account.' };
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ─── Login ─────────────────────────────────────────────────────────────────

  async login(params: {
    email: string;
    password: string;
    mfaToken?: string;
    ipAddress: string;
    userAgent: string;
  }): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const { email, password, mfaToken, ipAddress, userAgent } = params;

    // IP-level rate limiting — checked before user lookup to prevent timing oracle
    await this.checkIpRateLimit(ipAddress);

    const userResult = await this.deps.db.query<UserRow>(
      `SELECT id, email, email_verified_at, password_hash, mfa_secret, mfa_backup_codes,
              mfa_enabled, role, company_id, last_login_at, login_attempts, locked_until
       FROM users
       WHERE email = $1 AND deleted_at IS NULL`,
      [email.toLowerCase()],
    );

    // Use constant-time comparison path even if user not found
    if (userResult.rows.length === 0) {
      await this.simulateArgon2Delay();
      throw new AuthenticationError('Invalid email or password');
    }

    const user = userResult.rows[0]!;

    // Check account lockout
    if (user.locked_until && user.locked_until > new Date()) {
      const secondsRemaining = Math.ceil(
        (user.locked_until.getTime() - Date.now()) / 1000,
      );
      throw new TooManyRequestsError(
        `Account locked. Try again in ${secondsRemaining} seconds.`,
      );
    }

    // Verify password
    const passwordValid = await verifyPassword(user.password_hash, password);
    if (!passwordValid) {
      await this.recordFailedLogin(user.id, user.login_attempts, ipAddress);
      throw new AuthenticationError('Invalid email or password');
    }

    // Verify email before allowing login
    if (!user.email_verified_at) {
      throw new AuthenticationError('Please verify your email address before logging in');
    }

    // MFA check
    if (user.mfa_enabled) {
      if (!mfaToken) {
        throw new AuthenticationError('MFA token required');
      }
      const mfaValid = await this.verifyMfaToken(user, mfaToken);
      if (!mfaValid) {
        throw new AuthenticationError('Invalid MFA token');
      }
    }

    // Reset failed login counter on success
    await this.deps.db.query(
      `UPDATE users SET login_attempts = 0, locked_until = NULL, last_login_at = NOW()
       WHERE id = $1`,
      [user.id],
    );

    // Generate tokens
    const accessToken = this.signAccessToken({
      sub: user.id,
      role: user.role,
      companyId: user.company_id,
      mfaVerified: user.mfa_enabled,
    });

    const { tokenFamily, tokenValue, fullToken } = generateRefreshToken();
    const tokenHash = await hashSecret(tokenValue);
    const redisKey = REDIS_KEYS.refreshToken(tokenFamily);

    await this.deps.redis.setex(
      redisKey,
      REFRESH_TOKEN_TTL_SECONDS,
      JSON.stringify({ hash: tokenHash, userId: user.id, companyId: user.company_id }),
    );

    // Device fingerprint check — alert on new device
    const fingerprint = computeDeviceFingerprint(
      userAgent,
      ipAddress,
      this.deps.jwtRefreshHmacSecret,
    );
    const deviceKey = REDIS_KEYS.deviceFingerprint(user.id);
    const knownFingerprints = await this.deps.redis.smembers(deviceKey);

    if (!knownFingerprints.includes(fingerprint)) {
      await this.deps.redis.sadd(deviceKey, fingerprint);
      // Only alert if user has previously logged in (not first login)
      if (user.last_login_at) {
        sendEmail(
          buildNewDeviceAlertEmail({
            recipientEmail: user.email,
            ip: ipAddress,
            userAgent,
            fromEmail: this.deps.sesFromEmail,
          }),
        ).catch((err: unknown) => {
          this.deps.log.error({ err }, 'Failed to send new device alert');
        });
      }
    }

    const client = await this.deps.db.connect();
    try {
      await this.writeAuditLog(client, {
        eventType: 'user.login',
        actorUserId: user.id,
        actorIp: ipAddress,
        resourceType: 'user',
        resourceId: user.id,
        payload: { mfaVerified: user.mfa_enabled },
      });
    } finally {
      client.release();
    }

    return {
      accessToken,
      refreshToken: fullToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  // ─── Refresh ───────────────────────────────────────────────────────────────

  async refresh(fullToken: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    let tokenFamily: string;
    let tokenValue: string;
    try {
      ({ tokenFamily, tokenValue } = parseRefreshToken(fullToken));
    } catch {
      throw new AuthenticationError('Invalid refresh token');
    }

    const redisKey = REDIS_KEYS.refreshToken(tokenFamily);
    const stored = await this.deps.redis.get(redisKey);

    if (!stored) {
      throw new AuthenticationError('Refresh token expired or invalid');
    }

    let parsed: { hash: string; userId: string; companyId: string };
    try {
      parsed = JSON.parse(stored) as { hash: string; userId: string; companyId: string };
    } catch {
      throw new AuthenticationError('Malformed refresh token data');
    }

    const valid = await verifySecret(parsed.hash, tokenValue);
    if (!valid) {
      // Possible token theft — delete the family entirely
      await this.deps.redis.del(redisKey);
      throw new AuthenticationError('Invalid refresh token');
    }

    // Fetch current user role (may have changed since token was issued)
    const userResult = await this.deps.db.query<Pick<UserRow, 'id' | 'role' | 'company_id' | 'mfa_enabled' | 'deleted_at'>>(
      `SELECT id, role, company_id, mfa_enabled
       FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [parsed.userId],
    );
    const user = userResult.rows[0];
    if (!user) {
      await this.deps.redis.del(redisKey);
      throw new AuthenticationError('User account not found');
    }

    // Rotate: delete old token and issue new one (single-use enforcement)
    await this.deps.redis.del(redisKey);

    const newAccessToken = this.signAccessToken({
      sub: user.id,
      role: user.role,
      companyId: user.company_id,
      mfaVerified: user.mfa_enabled,
    });

    const { tokenFamily: newFamily, tokenValue: newValue, fullToken: newFullToken } = generateRefreshToken();
    const newHash = await hashSecret(newValue);
    await this.deps.redis.setex(
      REDIS_KEYS.refreshToken(newFamily),
      REFRESH_TOKEN_TTL_SECONDS,
      JSON.stringify({ hash: newHash, userId: user.id, companyId: user.company_id }),
    );

    return {
      accessToken: newAccessToken,
      refreshToken: newFullToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  // ─── Logout ────────────────────────────────────────────────────────────────

  async logout(fullToken: string): Promise<void> {
    try {
      const { tokenFamily } = parseRefreshToken(fullToken);
      await this.deps.redis.del(REDIS_KEYS.refreshToken(tokenFamily));
    } catch {
      // Token already invalid — treat as successful logout
    }
  }

  // ─── Verify Email ──────────────────────────────────────────────────────────

  async verifyEmail(token: string): Promise<{ message: string }> {
    let payload: { sub: string; email: string; jti: string; type: string };
    try {
      payload = jwt.verify(token, this.deps.jwtEmailSecret) as typeof payload;
    } catch {
      throw new ValidationError('Invalid or expired verification link');
    }

    if (payload.type !== 'email_verify') {
      throw new ValidationError('Invalid token type');
    }

    // Ensure token hasn't already been used (replay prevention)
    const jtiKey = REDIS_KEYS.emailJti(payload.jti);
    const used = await this.deps.redis.get(jtiKey);
    if (used) {
      throw new ValidationError('Verification link already used');
    }

    const result = await this.deps.db.query<{ id: string; email_verified_at: Date | null }>(
      'SELECT id, email_verified_at FROM users WHERE id = $1 AND deleted_at IS NULL',
      [payload.sub],
    );
    const user = result.rows[0];
    if (!user) throw new NotFoundError('User');

    if (user.email_verified_at) {
      return { message: 'Email already verified' };
    }

    await this.deps.db.query(
      'UPDATE users SET email_verified_at = NOW() WHERE id = $1',
      [user.id],
    );

    // Mark JTI as consumed
    await this.deps.redis.setex(jtiKey, EMAIL_TOKEN_TTL_SECONDS, '1');

    return { message: 'Email verified successfully' };
  }

  // ─── MFA Setup ─────────────────────────────────────────────────────────────

  async setupMfa(userId: string): Promise<{ secret: string; qrCodeUri: string }> {
    const userResult = await this.deps.db.query<Pick<UserRow, 'id' | 'email' | 'mfa_enabled'>>(
      'SELECT id, email, mfa_enabled FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new NotFoundError('User');
    if (user.mfa_enabled) {
      throw new ConflictError('MFA is already enabled on this account');
    }

    const secret = authenticator.generateSecret();
    const encryptedSecret = await encryptField(secret, this.deps.kmsKeyId);

    // Store secret in DB (mfa_enabled stays FALSE until verified)
    await this.deps.db.query(
      'UPDATE users SET mfa_secret = $1 WHERE id = $2',
      [encryptedSecret, userId],
    );

    const otpAuthUri = authenticator.keyuri(user.email, 'Lowleads', secret);
    const qrCodeUri = await QRCode.toDataURL(otpAuthUri);

    return { secret, qrCodeUri };
  }

  // ─── MFA Verify ────────────────────────────────────────────────────────────

  async verifyMfaSetup(
    userId: string,
    token: string,
  ): Promise<{ backupCodes: string[] }> {
    const userResult = await this.deps.db.query<Pick<UserRow, 'id' | 'mfa_secret' | 'mfa_enabled'>>(
      'SELECT id, mfa_secret, mfa_enabled FROM users WHERE id = $1 AND deleted_at IS NULL',
      [userId],
    );
    const user = userResult.rows[0];
    if (!user) throw new NotFoundError('User');
    if (user.mfa_enabled) {
      throw new ConflictError('MFA is already enabled');
    }
    if (!user.mfa_secret) {
      throw new ValidationError('Call MFA setup first to generate a secret');
    }

    const secret = await decryptField(user.mfa_secret);
    const isValid = authenticator.check(token, secret);
    if (!isValid) {
      throw new AuthenticationError('Invalid MFA token');
    }

    const backupCodes = generateBackupCodes(8);
    const backupCodeHashes = await hashBackupCodes(backupCodes);

    await this.deps.db.query(
      `UPDATE users SET mfa_enabled = TRUE, mfa_backup_codes = $1 WHERE id = $2`,
      [JSON.stringify(backupCodeHashes), userId],
    );

    const client = await this.deps.db.connect();
    try {
      await this.writeAuditLog(client, {
        eventType: 'user.mfa_enabled',
        actorUserId: userId,
        actorIp: null,
        resourceType: 'user',
        resourceId: userId,
        payload: {},
      });
    } finally {
      client.release();
    }

    return { backupCodes };
  }

  // ─── Password Reset Request ────────────────────────────────────────────────

  async requestPasswordReset(email: string): Promise<void> {
    const result = await this.deps.db.query<Pick<UserRow, 'id' | 'email'>>(
      'SELECT id, email FROM users WHERE email = $1 AND deleted_at IS NULL',
      [email.toLowerCase()],
    );
    const user = result.rows[0];

    // Always return success — never reveal whether email exists
    if (!user) return;

    const jti = generateJti();
    const token = jwt.sign(
      { sub: user.id, email: user.email, jti, type: 'password_reset' },
      this.deps.jwtPasswordResetSecret,
      { expiresIn: PASSWORD_RESET_TTL_SECONDS },
    );

    // Reserve JTI (mark as issued but not yet used)
    await this.deps.redis.setex(
      REDIS_KEYS.passwordResetJti(jti),
      PASSWORD_RESET_TTL_SECONDS,
      'issued',
    );

    const resetLink = `${this.deps.appUrl}/reset-password?token=${token}`;
    sendEmail(
      buildPasswordResetEmail({
        recipientEmail: user.email,
        resetLink,
        fromEmail: this.deps.sesFromEmail,
      }),
    ).catch((err: unknown) => {
      this.deps.log.error({ err }, 'Failed to send password reset email');
    });
  }

  // ─── Password Reset ────────────────────────────────────────────────────────

  async resetPassword(token: string, newPassword: string): Promise<void> {
    let payload: { sub: string; email: string; jti: string; type: string };
    try {
      payload = jwt.verify(token, this.deps.jwtPasswordResetSecret) as typeof payload;
    } catch {
      throw new ValidationError('Invalid or expired reset link');
    }

    if (payload.type !== 'password_reset') {
      throw new ValidationError('Invalid token type');
    }

    const jtiKey = REDIS_KEYS.passwordResetJti(payload.jti);
    const jtiState = await this.deps.redis.get(jtiKey);

    if (!jtiState || jtiState === 'used') {
      throw new ValidationError('Reset link already used or expired');
    }

    const newHash = await hashPassword(newPassword);

    await this.deps.db.query(
      `UPDATE users SET password_hash = $1, login_attempts = 0, locked_until = NULL
       WHERE id = $2 AND deleted_at IS NULL`,
      [newHash, payload.sub],
    );

    // Mark JTI as consumed (prevent replay)
    await this.deps.redis.setex(jtiKey, PASSWORD_RESET_TTL_SECONDS, 'used');

    // Invalidate all active sessions by deleting known device fingerprints
    // Refresh tokens can't be enumerated without scanning Redis, so we rely on
    // users being unable to use old JWTs (15-min expiry) — no full session invalidation here.
    // For stronger security: add a per-user session generation counter (Phase 2 enhancement).
    await this.deps.redis.del(REDIS_KEYS.deviceFingerprint(payload.sub));

    const client = await this.deps.db.connect();
    try {
      await this.writeAuditLog(client, {
        eventType: 'user.password_reset',
        actorUserId: payload.sub,
        actorIp: null,
        resourceType: 'user',
        resourceId: payload.sub,
        payload: {},
      });
    } finally {
      client.release();
    }
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private signAccessToken(payload: AccessTokenPayload): string {
    return jwt.sign(payload, this.deps.jwtAccessSecret, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      algorithm: 'HS256',
    });
  }

  private signEmailVerificationToken(userId: string, email: string): string {
    const jti = generateJti();
    return jwt.sign(
      { sub: userId, email, jti, type: 'email_verify' },
      this.deps.jwtEmailSecret,
      { expiresIn: EMAIL_TOKEN_TTL_SECONDS },
    );
  }

  private async checkIpRateLimit(ip: string): Promise<void> {
    const blockedKey = REDIS_KEYS.ipBlocked(ip);
    const isBlocked = await this.deps.redis.get(blockedKey);
    if (isBlocked) {
      throw new TooManyRequestsError('Too many failed login attempts from this IP');
    }

    const attemptsKey = REDIS_KEYS.ipLoginAttempts(ip);
    const attempts = await this.deps.redis.incr(attemptsKey);
    if (attempts === 1) {
      await this.deps.redis.expire(attemptsKey, IP_RATE_WINDOW_SECONDS);
    }
    if (attempts > IP_RATE_MAX_ATTEMPTS) {
      await this.deps.redis.setex(blockedKey, IP_BLOCK_DURATION_SECONDS, '1');
      throw new TooManyRequestsError('Too many failed login attempts from this IP');
    }
  }

  private async recordFailedLogin(
    userId: string,
    currentAttempts: number,
    ip: string,
  ): Promise<void> {
    const newAttempts = currentAttempts + 1;
    if (newAttempts >= MAX_LOGIN_ATTEMPTS) {
      // Exponential backoff on repeat lockouts
      const lockoutSeconds =
        LOCKOUT_DURATION_SECONDS * Math.pow(2, Math.max(0, newAttempts - MAX_LOGIN_ATTEMPTS));
      const lockedUntil = new Date(Date.now() + Math.min(lockoutSeconds, 86_400) * 1000);
      await this.deps.db.query(
        `UPDATE users SET login_attempts = $1, locked_until = $2 WHERE id = $3`,
        [newAttempts, lockedUntil, userId],
      );

      const client = await this.deps.db.connect();
      try {
        await this.writeAuditLog(client, {
          eventType: 'user.account_locked',
          actorUserId: userId,
          actorIp: ip,
          resourceType: 'user',
          resourceId: userId,
          payload: { attempts: newAttempts, lockedUntil: lockedUntil.toISOString() },
        });
      } finally {
        client.release();
      }
    } else {
      await this.deps.db.query(
        'UPDATE users SET login_attempts = $1 WHERE id = $2',
        [newAttempts, userId],
      );
    }
  }

  private async verifyMfaToken(user: UserRow, token: string): Promise<boolean> {
    if (!user.mfa_secret) return false;

    const secret = await decryptField(user.mfa_secret);

    // Try TOTP first
    if (authenticator.check(token, secret)) return true;

    // Try backup codes
    if (user.mfa_backup_codes && token.length === 10) {
      const codeIndex = await verifyBackupCode(token, user.mfa_backup_codes);
      if (codeIndex !== null) {
        // Consume the used backup code (replace with empty string hash)
        const updatedCodes = [...user.mfa_backup_codes];
        updatedCodes[codeIndex] = '';
        await this.deps.db.query(
          'UPDATE users SET mfa_backup_codes = $1 WHERE id = $2',
          [JSON.stringify(updatedCodes), user.id],
        );
        return true;
      }
    }

    return false;
  }

  // Constant-time delay to prevent timing attacks when user not found
  private async simulateArgon2Delay(): Promise<void> {
    const dummy = '$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHQ$RdescudvJCsgt3ub+b+dWRWJTmaasfasdf';
    await verifyPassword(dummy, 'dummy_password_check').catch(() => undefined);
  }

  private async writeAuditLog(
    client: PoolClient,
    params: {
      eventType: string;
      actorUserId: string | null;
      actorIp: string | null;
      resourceType: string;
      resourceId: string;
      payload: Record<string, unknown>;
    },
  ): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (event_type, actor_user_id, actor_ip, target_resource_type, target_resource_id, payload)
       VALUES ($1, $2, $3::INET, $4, $5, $6)`,
      [
        params.eventType,
        params.actorUserId,
        params.actorIp,
        params.resourceType,
        params.resourceId,
        JSON.stringify(params.payload),
      ],
    );
  }
}
