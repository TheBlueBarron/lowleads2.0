import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { CompanyService } from './companies.service.js';
import {
  UpdateCompanyBody,
  CompanyResponse,
  EscrowBalanceResponse,
  EscrowHistoryResponse,
  EscrowHistoryQuery,
} from './companies.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function companyRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CompanyService({
    db: fastify.db.primary,
    log: fastify.log,
  });

  // ─── GET /companies/me ────────────────────────────────────────────────────
  fastify.get(
    '/me',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: CompanyResponse }, tags: ['companies'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getProfile(request.user.companyId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── PATCH /companies/me ─────────────────────────────────────────────────
  fastify.patch<{ Body: UpdateCompanyBody }>(
    '/me',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: UpdateCompanyBody,
        response: { 200: CompanyResponse },
        tags: ['companies'],
      },
    },
    async (request: FastifyRequest<{ Body: UpdateCompanyBody }>, reply: FastifyReply) => {
      try {
        const result = await service.updateProfile(request.user.companyId, request.body);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /companies/me/escrow ─────────────────────────────────────────────
  fastify.get(
    '/me/escrow',
    {
      preHandler: fastify.authenticateOwner,
      schema: { response: { 200: EscrowBalanceResponse }, tags: ['companies'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getEscrowBalance(request.user.companyId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /companies/me/escrow/history ─────────────────────────────────────
  fastify.get<{ Querystring: EscrowHistoryQuery }>(
    '/me/escrow/history',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        querystring: EscrowHistoryQuery,
        response: { 200: EscrowHistoryResponse },
        tags: ['companies'],
      },
    },
    async (request: FastifyRequest<{ Querystring: EscrowHistoryQuery }>, reply: FastifyReply) => {
      try {
        const result = await service.getEscrowHistory(request.user.companyId, {
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
}
