import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { recordActivity } from '../../activities/log.js';

const NoteCreate = z.object({
  subjectType: z.enum(['contact', 'company', 'deal']),
  subjectId: z.string().min(1),
  body: z.string().min(1).max(20_000),
});

const NoteList = z.object({
  subjectType: z.enum(['contact', 'company', 'deal']),
  subjectId: z.string().min(1),
});

export async function noteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/notes', async (req) => {
    const tenant = req.tenant!;
    const q = NoteList.parse(req.query);
    return tenant.db
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.organizationId, tenant.organizationId),
          eq(schema.notes.subjectType, q.subjectType),
          eq(schema.notes.subjectId, q.subjectId),
        ),
      )
      .orderBy(desc(schema.notes.createdAt));
  });

  app.post('/notes', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = NoteCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const id = generateId(Prefixes.note);
    await tenant.db.insert(schema.notes).values({
      id,
      organizationId: tenant.organizationId,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      authorId: tenant.userId,
      body: body.body,
    });
    await recordActivity(tenant, {
      type: 'note',
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      title: 'Nota añadida',
      body: body.body.slice(0, 280),
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'note', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.delete('/notes/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.notes)
      .where(and(eq(schema.notes.organizationId, tenant.organizationId), eq(schema.notes.id, id)))
      .returning({ id: schema.notes.id });
    if (!res.length) throw notFound('Note not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'note', resourceId: id });
    return reply.status(204).send();
  });
}
