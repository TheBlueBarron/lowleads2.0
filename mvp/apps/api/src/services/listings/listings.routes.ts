import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { ListingService } from './listings.service.js';
import {
  CreateListingBody,
  UpdateListingBody,
  ListingIdParam,
  ListingsQuery,
  SearchListingsQuery,
  ListingResponse,
  ListingsListResponse,
  SearchListingsResponse,
} from './listings.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function listingRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new ListingService({
    db: fastify.db.primary,
    log: fastify.log,
    sesFromEmail: fastify.config.sesFromEmail,
    appUrl: fastify.config.appUrl,
  });

  // ─── POST /listings ───────────────────────────────────────────────────────
  fastify.post<{ Body: CreateListingBody }>(
    '/',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: CreateListingBody,
        response: { 201: ListingResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Body: CreateListingBody }>, reply: FastifyReply) => {
      try {
        const result = await service.create(request.user.companyId, request.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /listings ────────────────────────────────────────────────────────
  fastify.get<{ Querystring: ListingsQuery }>(
    '/',
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: ListingsQuery,
        response: { 200: ListingsListResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Querystring: ListingsQuery }>, reply: FastifyReply) => {
      try {
        const result = await service.list(request.user.companyId, {
          status: request.query.status,
          cursor: request.query.cursor,
          limit: request.query.limit ?? 20,
        });
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /listings/search ─────────────────────────────────────────────────
  fastify.get<{ Querystring: SearchListingsQuery }>(
    '/search',
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: SearchListingsQuery,
        response: { 200: SearchListingsResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Querystring: SearchListingsQuery }>, reply: FastifyReply) => {
      try {
        const result = await service.search({
          query: request.query.q,
          serviceArea: request.query.serviceArea,
          cursor: request.query.cursor,
          limit: request.query.limit ?? 20,
        });
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /listings/:listingId ─────────────────────────────────────────────
  fastify.get<{ Params: ListingIdParam }>(
    '/:listingId',
    {
      preHandler: fastify.authenticate,
      schema: {
        params: ListingIdParam,
        response: { 200: ListingResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Params: ListingIdParam }>, reply: FastifyReply) => {
      try {
        const result = await service.get(request.user.companyId, request.params.listingId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── PATCH /listings/:listingId ───────────────────────────────────────────
  fastify.patch<{ Params: ListingIdParam; Body: UpdateListingBody }>(
    '/:listingId',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: ListingIdParam,
        body: UpdateListingBody,
        response: { 200: ListingResponse },
        tags: ['listings'],
      },
    },
    async (
      request: FastifyRequest<{ Params: ListingIdParam; Body: UpdateListingBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.update(
          request.user.companyId,
          request.params.listingId,
          request.body,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /listings/:listingId/activate ───────────────────────────────────
  fastify.post<{ Params: ListingIdParam }>(
    '/:listingId/activate',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: ListingIdParam,
        response: { 200: ListingResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Params: ListingIdParam }>, reply: FastifyReply) => {
      try {
        const result = await service.activate(request.user.companyId, request.params.listingId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── POST /listings/:listingId/pause ──────────────────────────────────────
  fastify.post<{ Params: ListingIdParam }>(
    '/:listingId/pause',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: ListingIdParam,
        response: { 200: ListingResponse },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Params: ListingIdParam }>, reply: FastifyReply) => {
      try {
        const result = await service.pause(request.user.companyId, request.params.listingId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── DELETE /listings/:listingId ──────────────────────────────────────────
  fastify.delete<{ Params: ListingIdParam }>(
    '/:listingId',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: ListingIdParam,
        response: { 200: Type.Object({ id: Type.String(), status: Type.String() }) },
        tags: ['listings'],
      },
    },
    async (request: FastifyRequest<{ Params: ListingIdParam }>, reply: FastifyReply) => {
      try {
        const result = await service.archive(request.user.companyId, request.params.listingId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
