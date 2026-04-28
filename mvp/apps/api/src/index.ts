import { loadSecrets } from './lib/secrets.js';
import { buildApp } from './app.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const HOST = process.env['HOST'] ?? '0.0.0.0';
const APP_URL = process.env['APP_URL'] ?? 'http://localhost:3000';
const LOG_LEVEL = process.env['LOG_LEVEL'] ?? 'info';

async function main(): Promise<void> {
  const secrets = await loadSecrets();

  const app = await buildApp({
    ...secrets,
    port: PORT,
    host: HOST,
    appUrl: APP_URL,
    logLevel: LOG_LEVEL,
  });

  await app.listen({ port: PORT, host: HOST });
}

main().catch((err: unknown) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
