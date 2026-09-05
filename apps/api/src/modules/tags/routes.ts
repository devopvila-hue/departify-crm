import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { badRequest, conflict, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

const TagCreate = z.object({
  name: z.string().min(1).max(60),
  color: z.string().max(20).optional(),
  entity: z.enum(['contact', 'company', 'deal']).default('contact'),
});

const TagAssign = z.object({
  entity: z.enum(['contact', 'company', 'deal']),
  targetIds: z.array(z.string()).min(1).max(500),
  tagId: z.string().min(1),
});

export async function tagRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/tags', async (req) => {
    const tenant = req.tenant!;
    return tenant.db.select().from(schema.tags).where(eq(schema.tags.organizationId, tenant.organizationId));
  });

  app.post('/tags', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = TagCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const existing = await tenant.db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.organizationId, tenant.organizationId), eq(schema.tags.name, body.name)))
      .limit(1);
    if (existing.length) throw conflict('Tag already exists');
    const id = generateId(Prefixes.tag);
    await tenant.db.insert(schema.tags).values({
      id,
      organizationId: tenant.organizationId,
      name: body.name,
      color: body.color ?? null,
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'tag', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.delete('/tags/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.tags)
      .where(and(eq(schema.tags.organizationId, tenant.organizationId), eq(schema.tags.id, id)))
      .returning({ id: schema.tags.id });
    if (!res.length) throw notFound('Tag not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'tag', resourceId: id });
    return reply.status(204).send();
  });

  // Bulk assign / unassign a tag to a list of targets.
  app.post('/tags/assign', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const parsed = TagAssign.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;

    const tagRows = await tenant.db
      .select({ id: schema.tags.id })
      .from(schema.tags)
      .where(and(eq(schema.tags.organizationId, tenant.organizationId), eq(schema.tags.id, body.tagId)))
      .limit(1);
    if (!tagRows.length) throw notFound('Tag not found');

    const table = body.entity === 'contact' ? schema.contactTags : body.entity === 'company' ? schema.companyTags : schema.dealTags;
    let assigned = 0;
    for (const targetId of body.targetIds) {
      const res = await tenant.db
        .insert(table)
        .values({ organizationId: tenant.organizationId, tagId: body.tagId, [body.entity === 'contact' ? 'contactId' : body.entity === 'company' ? 'companyId' : 'dealId']: targetId })
        .onConflictDoNothing()
        .returning({ x: sql`1` });
      if (res.length) assigned++;
    }
    await audit(tenant.db, tenant, {
      action: 'bulk',
      resourceType: `${body.entity}_tag`,
      metadata: { tagId: body.tagId, count: body.targetIds.length, assigned },
    });
    return { assigned, total: body.targetIds.length };
  });
}

import { sql } from 'drizzle-orm';
