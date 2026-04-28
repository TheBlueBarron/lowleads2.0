import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { TechnicianService } from './technicians.service.js';
import {
  CreateTechnicianBody,
  UpdateTechnicianBody,
  TechnicianIdParam,
  TechnicianResponse,
  TechnicianListResponse,
} from './technicians.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function technicianRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new TechnicianService({
    db: fastify.db.primary,
    log: fastify.log,
  });

  // ─── POST /technicians ────────────────────────────────────────────────────
  fastify.post<{ Body: CreateTechnicianBody }>(
    '/',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        body: CreateTechnicianBody,
        response: { 201: TechnicianResponse },
        tags: ['technicians'],
      },
    },
    async (request: FastifyRequest<{ Body: CreateTechnicianBody }>, reply: FastifyReply) => {
      try {
        const result = await service.create(request.user.companyId, request.body);
        return reply.status(201).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── GET /technicians ─────────────────────────────────────────────────────
  fastify.get(
    '/',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: TechnicianListResponse }, tags: ['technicians'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.list(request.user.companyId);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── PATCH /technicians/:technicianId ─────────────────────────────────────
  fastify.patch<{ Params: TechnicianIdParam; Body: UpdateTechnicianBody }>(
    '/:technicianId',
    {
      preHandler: fastify.authenticateOwner,
      schema: {
        params: TechnicianIdParam,
        body: UpdateTechnicianBody,
        response: { 200: TechnicianResponse },
        tags: ['technicians'],
      },
    },
    async (
      request: FastifyRequest<{ Params: TechnicianIdParam; Body: UpdateTechnicianBody }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.update(
          request.user.companyId,
          request.params.technicianId,
          request.body,
        );
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
