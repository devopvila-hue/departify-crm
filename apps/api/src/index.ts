import { buildApp, startSequenceWorker } from './server.js';
import { config } from './config.js';

const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`DEPARTIFY CRM API listening on http://${config.HOST}:${config.PORT}`);

// In-process sequence worker (Sprint 5). Disabled in test env to keep
// vitest runs deterministic.
const stopWorker = config.NODE_ENV === 'test' ? () => {} : startSequenceWorker(config.DATABASE_URL);
app.log.info('Sequence worker started in-process');

const shutdown = async (sig: string) => {
  app.log.info({ sig }, 'shutting down');
  stopWorker();
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
