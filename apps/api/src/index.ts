import { buildApp } from './server.js';
import { config } from './config.js';

const app = await buildApp();
await app.listen({ port: config.PORT, host: config.HOST });
app.log.info(`DEPARTIFY CRM API listening on http://${config.HOST}:${config.PORT}`);

const shutdown = async (sig: string) => {
  app.log.info({ sig }, 'shutting down');
  await app.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
