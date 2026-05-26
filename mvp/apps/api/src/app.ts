import Fastify, { type FastifyInstance } from 'fastify';
import fastifyJwt from '@fastify/jwt';
import fastifyCookie from '@fastify/cookie';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fp from 'fastify-plugin';
import type Redis from 'ioredis';
import type { AppSecrets } from './lib/secrets.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import authenticatePlugin from './plugins/authenticate.js';
import { authRoutes } from './services/auth/auth.routes.js';
import { companyRoutes } from './services/companies/companies.routes.js';
import { technicianRoutes } from './services/technicians/technicians.routes.js';
import { listingRoutes } from './services/listings/listings.routes.js';
import { leadRoutes } from './services/leads/leads.routes.js';
import { stripeRoutes } from './services/stripe/stripe.routes.js';
import { notificationRoutes } from './services/notifications/notifications.routes.js';
import { isAppError } from './lib/errors.js';

export interface AppConfig extends AppSecrets {
  port: number;
  host: string;
  appUrl: string;
  logLevel: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    config: {
      jwtAccessSecret: string;
      jwtRefreshHmacSecret: string;
      jwtEmailSecret: string;
      jwtPasswordResetSecret: string;
      kmsKeyId: string;
      sesFromEmail: string;
      appUrl: string;
      stripeSecretKey: string;
      stripeWebhookSecret: string;
    };
  }
}

export async function buildApp(config: AppConfig): Promise<FastifyInstance> {
  const fastify = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            serializers: {
              req(request) {
                return {
                  method: request.method,
                  url: request.url,
                  // Hash user IP for logging — no raw PII in logs
                  remoteAddress: request.ip ? `[${request.ip.length}chars]` : 'unknown',
                };
              },
            },
          },
    trustProxy: true,
    ajv: {
      customOptions: {
        strict: false,
        keywords: ['kind', 'modifier'],
      },
    },
  });

  // ─── Security headers ───────────────────────────────────────────────────
  await fastify.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'none'"],
        frameSrc: ["'none'"],
        formAction: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31_536_000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // ─── CORS ──────────────────────────────────────────────────────────────
  const allowedOrigins =
    config.appUrl === 'http://localhost:3000'
      ? ['http://localhost:3000']
      : ['https://lowleads.com', 'https://www.lowleads.com'];

  await fastify.register(fastifyCors, {
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  // ─── Cookies ───────────────────────────────────────────────────────────
  await fastify.register(fastifyCookie, {
    secret: config.cookieSecret,
    hook: 'onRequest',
  });

  // ─── JWT ───────────────────────────────────────────────────────────────
  await fastify.register(fastifyJwt, {
    secret: config.jwtAccessSecret,
    sign: { algorithm: 'HS256', expiresIn: '15m' },
    verify: { algorithms: ['HS256'] },
  });

  // ─── Redis ─────────────────────────────────────────────────────────────
  await fastify.register(redisPlugin, { url: config.redisUrl });

  // ─── Rate limiting ──────────────────────────────────────────────────────
  await fastify.register(fastifyRateLimit, {
    redis: fastify.redis as unknown as Redis,
    global: false,
    max: 120,
    timeWindow: 60_000,
    keyGenerator: (request) => request.user?.sub ?? request.ip,
    errorResponseBuilder: () => ({
      error: { code: 'RATE_LIMITED', message: 'Too many requests' },
    }),
  });

  // ─── Database ──────────────────────────────────────────────────────────
  await fastify.register(dbPlugin, {
    primaryUrl: config.databaseUrl,
    replicaUrl: config.databaseReplicaUrl,
  });

  // ─── Auth plugin ────────────────────────────────────────────────────────
  await fastify.register(authenticatePlugin);

  // ─── Config decorator ──────────────────────────────────────────────────
  await fastify.register(
    fp(async (f) => {
      f.decorate('config', {
        jwtAccessSecret: config.jwtAccessSecret,
        jwtRefreshHmacSecret: config.jwtRefreshHmacSecret,
        jwtEmailSecret: config.jwtEmailSecret,
        jwtPasswordResetSecret: config.jwtPasswordResetSecret,
        kmsKeyId: config.kmsKeyId,
        sesFromEmail: config.sesFromEmail,
        appUrl: config.appUrl,
        stripeSecretKey: config.stripeSecretKey,
        stripeWebhookSecret: config.stripeWebhookSecret,
      });
    }),
  );

  // ─── Routes ─────────────────────────────────────────────────────────────
  await fastify.register(authRoutes, { prefix: '/v1/auth' });
  await fastify.register(companyRoutes, { prefix: '/v1/companies' });
  await fastify.register(technicianRoutes, { prefix: '/v1/technicians' });
  await fastify.register(listingRoutes, { prefix: '/v1/listings' });
  await fastify.register(leadRoutes, { prefix: '/v1/leads' });
  await fastify.register(stripeRoutes, { prefix: '/v1/billing' });
  await fastify.register(notificationRoutes, { prefix: '/v1/notifications' });

  // ─── Global error handler ───────────────────────────────────────────────
  fastify.setErrorHandler((err, _request, reply) => {
    if (isAppError(err)) {
      return reply.status(err.statusCode).send({
        error: { code: err.code, message: err.message },
      });
    }
    fastify.log.error(err);
    return reply.status(500).send({
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred' },
    });
  });

  // ─── Health check ───────────────────────────────────────────────────────
  fastify.get('/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  return fastify;
}
