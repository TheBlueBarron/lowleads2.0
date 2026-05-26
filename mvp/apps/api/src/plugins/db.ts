import fp from 'fastify-plugin';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';
import { initDb, getPrimaryPool, getReplicaPool, closeDb } from '@lowleads/db';

declare module 'fastify' {
  interface FastifyInstance {
    db: {
      primary: ReturnType<typeof getPrimaryPool>;
      replica: ReturnType<typeof getReplicaPool>;
      // Set RLS context for the current request's company
      withCompanyContext: <T>(
        companyId: string,
        fn: (client: PoolClient) => Promise<T>,
      ) => Promise<T>;
    };
  }
}

interface DbPluginOptions {
  primaryUrl: string;
  replicaUrl?: string;
}

export default fp(
  async (fastify: FastifyInstance, options: DbPluginOptions) => {
    initDb({ primaryUrl: options.primaryUrl, replicaUrl: options.replicaUrl });

    const primary = getPrimaryPool();
    const replica = getReplicaPool();

    async function withCompanyContext<T>(
      companyId: string,
      fn: (client: PoolClient) => Promise<T>,
    ): Promise<T> {
      const client = await primary.connect();
      try {
        // Set the RLS context variable — used by all RLS policies
        await client.query('SELECT set_config($1, $2, TRUE)', [
          'app.current_company_id',
          companyId,
        ]);
        return await fn(client);
      } finally {
        client.release();
      }
    }

    fastify.decorate('db', { primary, replica, withCompanyContext });

    fastify.addHook('onClose', async () => {
      await closeDb();
    });
  },
  { name: 'db' },
);
