import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { AuthService } from './auth.service.js';
import {
  RegisterBody,
  RegisterTechnicianBody,
  LoginBody,
  MfaVerifyBody,
  PasswordResetRequestBody,
  PasswordResetBody,
  VerifyEmailBody,
  AuthTokenResponse,
  MessageResponse,
  MfaSetupResponse,
  MfaVerifyResponse,
} from './auth.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

const REFRESH_TOKEN_COOKIE = 'refresh_token';

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env['NODE_ENV'] === 'production',
  sameSite: 'strict' as const,
  path: '/v1/auth/refresh',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

function getUserAgent(request: FastifyRequest): string {
  return request.headers['user-agent'] ?? 'unknown';
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new AuthService({
    db: fastify.db.primary,
    redis: fastify.redis,
    log: fastify.log,
    jwtAccessSecret: fastify.config.jwtAccessSecret,
    jwtRefreshHmacSecret: fastify.config.jwtRefreshHmacSecret,
    jwtEmailSecret: fastify.config.jwtEmailSecret,
    jwtPasswordResetSecret: fastify.config.jwtPasswordResetSecret,
    kmsKeyId: fastify.config.kmsKeyId,
    sesFromEmail: fastify.config.sesFromEmail,
    appUrl: fastify.config.appUrl,
  });

  // ─── POST /auth/register ──────────────────────────────────────────────────
  fastify.post<{ Body: RegisterBody }>(
    '/register',
    {
      schema: {
        body: RegisterBody,
        response: { 201: MessageResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: RegisterBody }>, reply: FastifyReply) => {
      try {
        const result = await service.register({
          email: request.body.email,
          password: request.body.password,
          companyName: request.body.companyName,
          companySlug: request.body.companySlug,
        });
        return reply.status(201).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/register-technician (employee self-registration) ───────────
  fastify.post<{ Body: RegisterTechnicianBody }>(
    '/register-technician',
    {
      schema: {
        body: RegisterTechnicianBody,
        response: { 201: MessageResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: RegisterTechnicianBody }>, reply: FastifyReply) => {
      try {
        const result = await service.registerTechnician({
          email: request.body.email,
          password: request.body.password,
          displayName: request.body.displayName,
          companyJoinCode: request.body.companyJoinCode,
        });
        return reply.status(201).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/login ─────────────────────────────────────────────────────
  fastify.post<{ Body: LoginBody }>(
    '/login',
    {
      schema: {
        body: LoginBody,
        response: { 200: AuthTokenResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: LoginBody }>, reply: FastifyReply) => {
      try {
        const result = await service.login({
          email: request.body.email,
          password: request.body.password,
          mfaToken: request.body.mfaToken,
          ipAddress: getClientIp(request),
          userAgent: getUserAgent(request),
        });

        void reply.setCookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);

        return reply.status(200).send({
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
        });
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/refresh ───────────────────────────────────────────────────
  fastify.post(
    '/refresh',
    {
      schema: {
        response: { 200: AuthTokenResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE];
        if (!refreshToken) {
          return reply.status(401).send({
            error: { code: 'UNAUTHORIZED', message: 'Refresh token cookie missing' },
          });
        }

        const result = await service.refresh(refreshToken);

        void reply.setCookie(REFRESH_TOKEN_COOKIE, result.refreshToken, COOKIE_OPTIONS);

        return reply.status(200).send({
          accessToken: result.accessToken,
          expiresIn: result.expiresIn,
        });
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/logout ────────────────────────────────────────────────────
  fastify.post(
    '/logout',
    {
      preHandler: fastify.authenticate,
      schema: {
        response: { 204: Type.Null() },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const refreshToken = request.cookies[REFRESH_TOKEN_COOKIE] ?? '';
      await service.logout(refreshToken);
      void reply.clearCookie(REFRESH_TOKEN_COOKIE, { path: COOKIE_OPTIONS.path });
      return reply.status(204).send();
    },
  );

  // ─── POST /auth/verify-email ──────────────────────────────────────────────
  fastify.post<{ Body: VerifyEmailBody }>(
    '/verify-email',
    {
      schema: {
        body: VerifyEmailBody,
        response: { 200: MessageResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: VerifyEmailBody }>, reply: FastifyReply) => {
      try {
        const result = await service.verifyEmail(request.body.token);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/mfa/setup ─────────────────────────────────────────────────
  fastify.post(
    '/mfa/setup',
    {
      preHandler: fastify.authenticate,
      schema: {
        response: { 200: MfaSetupResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.setupMfa(request.user.sub);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/mfa/verify ────────────────────────────────────────────────
  fastify.post<{ Body: MfaVerifyBody }>(
    '/mfa/verify',
    {
      preHandler: fastify.authenticate,
      schema: {
        body: MfaVerifyBody,
        response: { 200: MfaVerifyResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: MfaVerifyBody }>, reply: FastifyReply) => {
      try {
        const result = await service.verifyMfaSetup(request.user.sub, request.body.token);
        return reply.status(200).send({
          backupCodes: result.backupCodes,
          message: 'MFA enabled. Store these backup codes securely — they will not be shown again.',
        });
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auth/password/reset-request ───────────────────────────────────
  fastify.post<{ Body: PasswordResetRequestBody }>(
    '/password/reset-request',
    {
      schema: {
        body: PasswordResetRequestBody,
        response: { 200: MessageResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: PasswordResetRequestBody }>, reply: FastifyReply) => {
      // Always return 200 — never reveal whether email exists
      await service.requestPasswordReset(request.body.email).catch((err: unknown) => {
        fastify.log.error({ err }, 'Password reset request failed');
      });
      return reply.status(200).send({
        message: 'If an account exists for this email, a reset link has been sent.',
      });
    },
  );

  // ─── POST /auth/password/reset ────────────────────────────────────────────
  fastify.post<{ Body: PasswordResetBody }>(
    '/password/reset',
    {
      schema: {
        body: PasswordResetBody,
        response: { 200: MessageResponse },
        tags: ['auth'],
      },
    },
    async (request: FastifyRequest<{ Body: PasswordResetBody }>, reply: FastifyReply) => {
      try {
        await service.resetPassword(request.body.token, request.body.newPassword);
        return reply.status(200).send({ message: 'Password reset successfully. Please log in.' });
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
