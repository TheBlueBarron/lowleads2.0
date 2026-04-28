import { Pool, type PoolConfig } from 'pg';

export interface DbConfig {
  primaryUrl: string;
  replicaUrl?: string;
  maxConnections?: number;
}

let primaryPool: Pool | null = null;
let replicaPool: Pool | null = null;

const BASE_POOL_CONFIG: Partial<PoolConfig> = {
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 30_000,
  // Disable prepared statements — compatible with PgBouncer transaction mode
  query_timeout: 30_000,
};

export function initDb(config: DbConfig): void {
  primaryPool = new Pool({
    ...BASE_POOL_CONFIG,
    connectionString: config.primaryUrl,
    max: config.maxConnections ?? 10,
  });

  primaryPool.on('error', (err) => {
    console.error('Unexpected postgres pool error', err);
  });

  if (config.replicaUrl) {
    replicaPool = new Pool({
      ...BASE_POOL_CONFIG,
      connectionString: config.replicaUrl,
      max: config.maxConnections ?? 10,
    });
    replicaPool.on('error', (err) => {
      console.error('Unexpected postgres replica pool error', err);
    });
  }
}

export function getPrimaryPool(): Pool {
  if (!primaryPool) throw new Error('DB not initialized — call initDb() first');
  return primaryPool;
}

export function getReplicaPool(): Pool {
  return replicaPool ?? getPrimaryPool();
}

export async function closeDb(): Promise<void> {
  await Promise.all([primaryPool?.end(), replicaPool?.end()]);
  primaryPool = null;
  replicaPool = null;
}
