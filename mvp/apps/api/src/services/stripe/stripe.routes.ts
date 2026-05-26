import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { StripeService } from './stripe.service.js';
import {
  CreateDepositSessionBody,
  CreateSubscriptionSessionBody,
  BillingPortalBody,
  CheckoutSessionResponse,
  BillingPortalResponse,
} from './stripe.schema.js';
import { sendError, isAppError, ValidationError } from '../../lib/errors.js';

export async function stripeRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new StripeService({
    db: fastify.db.primary,
    log: fastify.log,
    stripeSecretKey: fastify.config.stripeSecretKey,
    stripeWebhookSecret: fastify.config.stripeWebhookSecret,
    appUrl: fastify.config.appUrl,
  });

  // ─── POST /billing/deposit ────────────────────────────────────────────────
  fastify.post<{ Body: CreateDepositSessionBody }>(
    '/deposit',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: CreateDepositSessionBody,
        response: { 200: CheckoutSessionResponse },
        tags: ['billing'],
      },
    },
    async (request: FastifyRequest<{ Body: CreateDepositSessionBody }>, reply: FastifyReply) => {
      try {
        const result = await service.createDepositSession(
          request.user.companyId,
          request.body.amountCents,
          request.body.returnUrl,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /billing/subscribe ──────────────────────────────────────────────
  fastify.post<{ Body: CreateSubscriptionSessionBody }>(
    '/subscribe',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: CreateSubscriptionSessionBody,
        response: { 200: CheckoutSessionResponse },
        tags: ['billing'],
      },
    },
    async (
      request: FastifyRequest<{ Body: CreateSubscriptionSessionBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.createSubscriptionSession(
          request.user.companyId,
          request.body.tier,
          request.body.returnUrl,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /billing/portal ─────────────────────────────────────────────────
  fastify.post<{ Body: BillingPortalBody }>(
    '/portal',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: BillingPortalBody,
        response: { 200: BillingPortalResponse },
        tags: ['billing'],
      },
    },
    async (request: FastifyRequest<{ Body: BillingPortalBody }>, reply: FastifyReply) => {
      try {
        const result = await service.createBillingPortal(
          request.user.companyId,
          request.body.returnUrl,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /billing/webhook ────────────────────────────────────────────────
  // Stripe signature verification requires the raw request body as a Buffer.
  // We register a scoped content-type parser inside a child context so it
  // does not override the global JSON parser for all other routes.
  void fastify.register(async (webhookScope) => {
    webhookScope.addContentTypeParser(
      'application/json',
      { parseAs: 'buffer' },
      (_req, body, done) => done(null, body),
    );

    webhookScope.post(
      '/webhook',
      { schema: { tags: ['billing'] } },
      async (request: FastifyRequest, reply: FastifyReply) => {
        const signature = request.headers['stripe-signature'];
        if (!signature || typeof signature !== 'string') {
          return sendError(reply, new ValidationError('Missing stripe-signature header'));
        }

        try {
          await service.handleWebhook(request.body as Buffer, signature);
          return reply.status(200).send({ received: true });
        } catch (err) {
          if (isAppError(err)) return sendError(reply, err);
          webhookScope.log.error({ err }, 'Stripe webhook error');
          return reply.status(400).send({ error: 'Webhook handler failed' });
        }
      },
    );
  });
}
