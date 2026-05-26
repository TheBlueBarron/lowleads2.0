import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { LeadService } from './leads.service.js';
import {
  SubmitLeadBody,
  LeadIdParam,
  UpdateLeadStatusBody,
  LeadsQuery,
  LeadSummaryResponse,
  LeadDetailResponse,
  LeadsListResponse,
} from './leads.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function leadRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new LeadService({
    db: fastify.db.primary,
    log: fastify.log,
    kmsKeyId: fastify.config.kmsKeyId,
    sesFromEmail: fastify.config.sesFromEmail,
    appUrl: fastify.config.appUrl,
  });

  // ─── POST /leads ──────────────────────────────────────────────────────────
  fastify.post<{ Body: SubmitLeadBody }>(
    '/',
    {
      preHandler: fastify.authenticate,
      schema: {
        body: SubmitLeadBody,
        response: { 201: LeadSummaryResponse },
        tags: ['leads'],
      },
    },
    async (request: FastifyRequest<{ Body: SubmitLeadBody }>, reply: FastifyReply) => {
      try {
        const result = await service.submit(request.user.sub, request.user.companyId, request.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /leads ───────────────────────────────────────────────────────────
  fastify.get<{ Querystring: LeadsQuery }>(
    '/',
    {
      preHandler: fastify.authenticate,
      schema: {
        querystring: LeadsQuery,
        response: { 200: LeadsListResponse },
        tags: ['leads'],
      },
    },
    async (request: FastifyRequest<{ Querystring: LeadsQuery }>, reply: FastifyReply) => {
      try {
        const result = await service.list(request.user.companyId, {
          ...request.query,
          limit: request.query.limit ?? 20,
        });
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /leads/:leadId ───────────────────────────────────────────────────
  fastify.get<{ Params: LeadIdParam }>(
    '/:leadId',
    {
      preHandler: fastify.authenticate,
      schema: {
        params: LeadIdParam,
        response: { 200: LeadDetailResponse },
        tags: ['leads'],
      },
    },
    async (request: FastifyRequest<{ Params: LeadIdParam }>, reply: FastifyReply) => {
      try {
        const result = await service.get(request.user.companyId, request.params.leadId, true);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── PATCH /leads/:leadId/status ──────────────────────────────────────────
  fastify.patch<{ Params: LeadIdParam; Body: UpdateLeadStatusBody }>(
    '/:leadId/status',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: LeadIdParam,
        body: UpdateLeadStatusBody,
        response: { 200: LeadSummaryResponse },
        tags: ['leads'],
      },
    },
    async (
      request: FastifyRequest<{ Params: LeadIdParam; Body: UpdateLeadStatusBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.updateStatus(
          request.user.companyId,
          request.params.leadId,
          request.body.status,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
