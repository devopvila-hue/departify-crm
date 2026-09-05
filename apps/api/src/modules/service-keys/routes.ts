/**
 * Service API key management — the integration path for DEPARTIFY and
 * any future automation. Keys are created by an org admin, shown ONCE
 * on creation, and stored as SHA-256 + prefix thereafter.
 *
 * Auth: requires authenticated user with role >= admin.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, isNull } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { randomToken, sha256 } from '../../lib/crypto.js';

const CreateKey = z.object({
  name: z.string().min(1).max(80),
  scopes: z.array(z.string().min(1).max(40)).max(20).default([]),
  expiresAt: z.string().datetime().optional(),
});

function buildPrefix(): string {
  // e.g. "dep_ak_live_4g7z"
  return `dep_ak_live_${randomToken(3)}`;
}

export async function serviceKeyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/service-keys', { preHandler: [requireRole('admin')] }, async (req) => {
    const tenant = req.tenant!;
    const rows = await tenant.db
      .select({
        id: schema.apiKeys.id,
        name: schema.apiKeys.name,
        prefix: schema.apiKeys.prefix,
        scopes: schema.apiKeys.scopes,
        status: schema.apiKeys.status,
        lastUsedAt: schema.apiKeys.lastUsedAt,
        expiresAt: schema.apiKeys.expiresAt,
        createdAt: schema.apiKeys.createdAt,
      })
      .from(schema.apiKeys)
      .where(and(eq(schema.apiKeys.organizationId, tenant.organizationId), isNull(schema.apiKeys.revokedAt)));
    return rows;
  });

  app.post('/service-keys', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const body = CreateKey.parse(req.body);
    const id = generateId(Prefixes.apiKey);
    const secret = randomToken(40);
    const prefix = buildPrefix();
    await tenant.db.insert(schema.apiKeys).values({
      id,
      organizationId: tenant.organizationId,
      name: body.name,
      tokenHash: sha256(secret),
      prefix,
      scopes: body.scopes,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
      createdBy: tenant.userId,
    });
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'api_key', resourceId: id });
    // The secret is returned ONLY here. The client must store it.
    return reply.status(201).send({ id, prefix, secret, scopes: body.scopes });
  });

  app.delete('/service-keys/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .update(schema.apiKeys)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(schema.apiKeys.organizationId, tenant.organizationId), eq(schema.apiKeys.id, id)))
      .returning({ id: schema.apiKeys.id });
    if (!res.length) throw notFound('Key not found');
    await audit(tenant.db, tenant, { action: 'integration_change', resourceType: 'api_key', resourceId: id, metadata: { revoked: true } });
    return reply.status(204).send();
  });
}
