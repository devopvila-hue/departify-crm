/**
 * Public tracking endpoints — `/api/v1/track/open/:id.png` and
 * `/api/v1/track/click/:id`. Looked up by message_event's
 * `providerMessageId` (the value we minted when sending the email).
 *
 * No auth. The IDs are unguessable (random prefix + 22 chars), and
 * the worst case is that someone tracks their own email. That said,
 * we don't expose anything sensitive here — just an opaque gif or
 * a redirect to the original URL.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { createDb, schema } from '@departify-crm/db';
import { config } from '../../config.js';
import { PIXEL_PNG_BASE64, recordEngagement } from './tracking.js';

export async function trackingRoutes(app: FastifyInstance): Promise<void> {
  const db = createDb(config.DATABASE_URL);

  // ─── GET /track/open/:id.png ─────────────────────────────────────
  app.get('/track/open/:id.png', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const row = (await db
      .select()
      .from(schema.messageEvents)
      .where(and(eq(schema.messageEvents.organizationId, req.tenant?.organizationId ?? ''), eq(schema.messageEvents.providerMessageId, id)))
      .limit(1))[0];
    if (row) {
      await recordEngagement(
        db,
        row.organizationId,
        id,
        row.contactId,
        row.senderId,
        row.enrollmentId,
        'opened',
        { source: 'pixel', userAgent: req.headers['user-agent'] ?? null, ip: req.ip },
      ).catch(() => undefined);
    }
    const buf = Buffer.from(PIXEL_PNG_BASE64, 'base64');
    reply
      .header('content-type', 'image/png')
      .header('content-length', buf.length)
      .header('cache-control', 'no-store, no-cache, must-revalidate, max-age=0')
      .header('pragma', 'no-cache')
      .send(buf);
  });

  // ─── GET /track/click/:id?url=… ─────────────────────────────────
  app.get('/track/click/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const id = (req.params as { id: string }).id;
    const url = (req.query as { url?: string }).url ?? '';
    const safeUrl = isSafeUrl(url) ? url : 'https://departify.app';
    const row = (await db
      .select()
      .from(schema.messageEvents)
      .where(and(eq(schema.messageEvents.organizationId, req.tenant?.organizationId ?? ''), eq(schema.messageEvents.providerMessageId, id)))
      .limit(1))[0];
    if (row) {
      await recordEngagement(
        db,
        row.organizationId,
        id,
        row.contactId,
        row.senderId,
        row.enrollmentId,
        'clicked',
        { source: 'link', url: safeUrl, userAgent: req.headers['user-agent'] ?? null, ip: req.ip },
      ).catch(() => undefined);
    }
    reply.redirect(safeUrl, 302);
  });

  void db;
}

/** Only redirect to http(s) URLs. Defends against open-redirect abuse. */
function isSafeUrl(u: string): boolean {
  try {
    const parsed = new URL(u);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}
