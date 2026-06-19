import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { Type } from '@sinclair/typebox';
import { CategoryService } from './categories.service.js';
import { sendError, isAppError } from '../../lib/errors.js';

const CategoryListResponse = Type.Object({
  data: Type.Array(
    Type.Object({
      id: Type.String({ format: 'uuid' }),
      parentId: Type.Union([Type.String({ format: 'uuid' }), Type.Null()]),
      name: Type.String(),
      isLeaf: Type.Boolean(),
    }),
  ),
  total: Type.Number(),
});

export async function categoryRoutes(fastify: FastifyInstance): Promise<void> {
  const service = new CategoryService({ db: fastify.db.primary });

  // ─── GET /categories (public — for onboarding / listing / referral UIs) ───
  fastify.get(
    '/',
    { schema: { response: { 200: CategoryListResponse }, tags: ['categories'] } },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const result = await service.list();
        return reply.status(200).send(result);
      } catch (err) {
        if (isAppError(err)) return sendError(reply, err);
        throw err;
      }
    },
  );
}
