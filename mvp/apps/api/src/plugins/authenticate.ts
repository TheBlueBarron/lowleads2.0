import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { AccessTokenPayload } from '@lowleads/shared-types';
import { AuthenticationError, ForbiddenError, sendError } from '../lib/errors.js';

declare module 'fastify' {
  interface FastifyRequest {
    user: AccessTokenPayload;
  }
}

export default fp(
  async (fastify: FastifyInstance) => {
    // Decorate all requests with a placeholder — populated by authenticate hook
    fastify.decorateRequest('user', null);

    // authenticate — attach to routes that require auth
    fastify.decorate(
      'authenticate',
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        try {
          await request.jwtVerify<AccessTokenPayload>();
        } catch {
          sendError(reply, new AuthenticationError());
        }
      },
    );

    // authenticateOwner — restrict to company_owner role
    fastify.decorate(
      'authenticateOwner',
      async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
        try {
          await request.jwtVerify<AccessTokenPayload>();
          if (request.user.role !== 'company_owner') {
            sendError(reply, new ForbiddenError('Company owner access required'));
          }
        } catch (err) {
          if (err instanceof Error && err.message.includes('owner')) {
            sendError(reply, new ForbiddenError(err.message));
          } else {
            sendError(reply, new AuthenticationError());
          }
        }
      },
    );
  },
  { name: 'authenticate' },
);

declare module 'fastify' {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    authenticateOwner: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}
