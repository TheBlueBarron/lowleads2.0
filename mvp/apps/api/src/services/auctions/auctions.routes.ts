import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { AuctionService } from './auctions.service.js';
import { StripeService } from '../stripe/stripe.service.js';
import {
  AuctionParams,
  PlaceBidBody,
  AuctionStateResponse,
  BidPlacedResponse,
  CompanyBidsResponse,
  BidCreditResponse,
  ResolveQuery,
  ResolveResponse,
} from './auctions.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function auctionRoutes(fastify: FastifyInstance): Promise<void> {
  const stripe = new StripeService({
    db: fastify.db.primary,
    log: fastify.log,
    stripeSecretKey: fastify.config.stripeSecretKey,
    stripeWebhookSecret: fastify.config.stripeWebhookSecret,
    appUrl: fastify.config.appUrl,
  });
  const service = new AuctionService({ db: fastify.db.primary, log: fastify.log, stripe });

  // ─── GET /auctions/:zip/:category_id/current ──────────────────────────────
  fastify.get<{ Params: AuctionParams }>(
    '/:zip/:category_id/current',
    {
      preHandler: fastify.authenticate,
      schema: {
        params: AuctionParams,
        response: { 200: AuctionStateResponse },
        tags: ['auctions'],
      },
    },
    async (request: FastifyRequest<{ Params: AuctionParams }>, reply: FastifyReply) => {
      try {
        const result = await service.getCurrent(
          request.params.zip,
          request.params.category_id,
          request.user.companyId,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auctions/:zip/:category_id/bid ─────────────────────────────────
  fastify.post<{ Params: AuctionParams; Body: PlaceBidBody }>(
    '/:zip/:category_id/bid',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: AuctionParams,
        body: PlaceBidBody,
        response: { 200: BidPlacedResponse },
        tags: ['auctions'],
      },
    },
    async (
      request: FastifyRequest<{ Params: AuctionParams; Body: PlaceBidBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.placeBid(
          request.user.companyId,
          request.params.zip,
          request.params.category_id,
          request.body.maxBidCents,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /auctions/me/bids (own company) ──────────────────────────────────
  // Path scoped to /me rather than /companies/:id to avoid an IDOR surface and
  // keep auction reads in this router.
  fastify.get(
    '/me/bids',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: CompanyBidsResponse }, tags: ['auctions'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.listCompanyBids(request.user.companyId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /auctions/me/bid-credit (own company) ────────────────────────────
  fastify.get(
    '/me/bid-credit',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: BidCreditResponse }, tags: ['auctions'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getBidCredit(request.user.companyId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /auctions/resolve-due (machine/cron only) ───────────────────────
  // Protected by a shared secret (CRON_SECRET) since there is no admin role yet.
  // Intended to be invoked by a month-end scheduled task (EventBridge / ECS
  // scheduled task / pg_cron http). Disabled (503) if no secret is configured.
  fastify.post<{ Querystring: ResolveQuery }>(
    '/resolve-due',
    {
      schema: { querystring: ResolveQuery, response: { 200: ResolveResponse }, tags: ['auctions'] },
    },
    async (request: FastifyRequest<{ Querystring: ResolveQuery }>, reply: FastifyReply) => {
      const expected = process.env['CRON_SECRET'];
      if (!expected) {
        return reply
          .status(503)
          .send({ error: { code: 'CRON_DISABLED', message: 'CRON_SECRET not configured' } });
      }
      if (request.headers['x-cron-secret'] !== expected) {
        return reply
          .status(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } });
      }
      try {
        const result = await service.resolveDuePeriod(request.query.period);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
