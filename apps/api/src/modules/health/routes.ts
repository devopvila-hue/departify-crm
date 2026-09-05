import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import { createDb } from '@departify-crm/db';
import { config } from '../../config.js';

export async function healthRoutes(app: FastifyInstance) {
  const db = createDb(config.DATABASE_URL);

  app.get('/health', async () => ({ ok: true, uptime: process.uptime() }));

  app.get('/ready', async (_req, reply) => {
    try {
      await db.execute(sql`select 1`);
      return { ok: true };
    } catch (err) {
      reply.status(503);
      return { ok: false, error: (err as Error).message };
    }
  });
}
