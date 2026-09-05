import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { badRequest, conflict, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

const FieldDefCreate = z.object({
  entity: z.enum(['contact', 'company', 'deal']),
  key: z.string().min(1).max(60).regex(/^[a-z_][a-z0-9_]*$/),
  label: z.string().min(1).max(120),
  type: z.enum(['text', 'textarea', 'number', 'boolean', 'date', 'datetime', 'select', 'multi_select', 'url', 'email']),
  options: z.array(z.string().min(1).max(120)).max(50).default([]),
  required: z.boolean().default(false),
  position: z.number().int().min(0).default(0),
});

const FieldDefUpdate = FieldDefCreate.partial();

export async function customFieldRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/custom-fields', async (req) => {
    const tenant = req.tenant!;
    const entity = z.enum(['contact', 'company', 'deal']).optional().parse((req.query as { entity?: string }).entity);
    const conds = [eq(schema.customFieldDefinitions.organizationId, tenant.organizationId)];
    if (entity) conds.push(eq(schema.customFieldDefinitions.entity, entity));
    return tenant.db
      .select()
      .from(schema.customFieldDefinitions)
      .where(and(...conds))
      .orderBy(asc(schema.customFieldDefinitions.position));
  });

  app.post('/custom-fields', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = FieldDefCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    if ((body.type === 'select' || body.type === 'multi_select') && body.options.length === 0) {
      throw badRequest('Select / multi_select require at least one option');
    }
    const existing = await tenant.db
      .select({ id: schema.customFieldDefinitions.id })
      .from(schema.customFieldDefinitions)
      .where(
        and(
          eq(schema.customFieldDefinitions.organizationId, tenant.organizationId),
          eq(schema.customFieldDefinitions.entity, body.entity),
          eq(schema.customFieldDefinitions.key, body.key),
        ),
      )
      .limit(1);
    if (existing.length) throw conflict('A field with this key already exists for this entity');
    const id = generateId(Prefixes.customFieldDef);
    await tenant.db.insert(schema.customFieldDefinitions).values({
      id,
      organizationId: tenant.organizationId,
      entity: body.entity,
      key: body.key,
      label: body.label,
      type: body.type,
      options: body.options,
      required: body.required ? 1 : 0,
      position: body.position,
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'custom_field_definition', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.patch('/custom-fields/:id', { preHandler: [requireRole('admin')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = FieldDefUpdate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = k === 'required' ? (v ? 1 : 0) : v;
    }
    const res = await tenant.db
      .update(schema.customFieldDefinitions)
      .set(updates)
      .where(and(eq(schema.customFieldDefinitions.organizationId, tenant.organizationId), eq(schema.customFieldDefinitions.id, id)))
      .returning({ id: schema.customFieldDefinitions.id });
    if (!res.length) throw notFound('Custom field not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'custom_field_definition', resourceId: id });
    return { ok: true, id };
  });

  app.delete('/custom-fields/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.organizationId, tenant.organizationId), eq(schema.customFieldDefinitions.id, id)))
      .returning({ id: schema.customFieldDefinitions.id });
    if (!res.length) throw notFound('Custom field not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'custom_field_definition', resourceId: id });
    return reply.status(204).send();
  });
}
