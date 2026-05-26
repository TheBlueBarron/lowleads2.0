import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { NotificationService } from './notifications.service.js';
import { UpdateNotificationPrefsBody, NotificationPrefsResponse } from './notifications.schema.js';
import { sendError, isAppError } from '../../lib/errors.js';

export async function notificationRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new NotificationService({
    db: fastify.db.primary,
    log: fastify.log,
  });

  // ─── GET /notifications/preferences ──────────────────────────────────────
  fastify.get(
    '/preferences',
    {
      preHandler: fastify.authenticate,
      schema: { response: { 200: NotificationPrefsResponse }, tags: ['notifications'] },
    },
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.getPrefs(request.user.sub);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );

  // ─── PATCH /notifications/preferences ────────────────────────────────────
  fastify.patch<{ Body: UpdateNotificationPrefsBody }>(
    '/preferences',
    {
      preHandler: fastify.authenticate,
      schema: {
        body: UpdateNotificationPrefsBody,
        response: { 200: NotificationPrefsResponse },
        tags: ['notifications'],
      },
    },
    async (request: FastifyRequest<{ Body: UpdateNotificationPrefsBody }>, reply: FastifyReply) => {
      try {
        const result = await service.updatePrefs(request.user.sub, request.body);
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
