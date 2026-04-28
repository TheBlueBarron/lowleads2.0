import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyInstance {
    redis: Redis;
  }
}

interface RedisPluginOptions {
  url: string;
}

export default fp(
  async (fastify: FastifyInstance, options: RedisPluginOptions) => {
    const redis = new Redis(options.url, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redis.on('error', (err: Error) => {
      fastify.log.error({ err }, 'Redis connection error');
    });

    await redis.ping();

    fastify.decorate('redis', redis);

    fastify.addHook('onClose', async () => {
      await redis.quit();
    });
  },
  { name: 'redis' },
);
