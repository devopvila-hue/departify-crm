import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, lt, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes, PaginationQuery, paginate } from '@departify-crm/shared';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { recordActivity } from '../../activities/log.js';

const TaskCreate = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(4000).optional(),
  dueAt: z.string().datetime().optional(),
  ownerId: z.string().max(64).optional(),
  subjectType: z.enum(['contact', 'company', 'deal', 'general']).default('general'),
  subjectId: z.string().max(64).optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
});

const TaskUpdate = TaskCreate.partial().extend({
  status: z.enum(['open', 'done', 'cancelled']).optional(),
});

const TaskList = z.object({
  ...PaginationQuery.shape,
  status: z.enum(['open', 'done', 'cancelled', 'all']).default('open'),
  overdue: z.coerce.boolean().default(false),
  subjectType: z.enum(['contact', 'company', 'deal', 'general']).optional(),
  subjectId: z.string().optional(),
});

export async function taskRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/tasks', async (req) => {
    const tenant = req.tenant!;
    const q = TaskList.parse(req.query);
    const conds = [eq(schema.tasks.organizationId, tenant.organizationId)];
    if (q.status !== 'all') conds.push(eq(schema.tasks.status, q.status));
    if (q.subjectType) conds.push(eq(schema.tasks.subjectType, q.subjectType));
    if (q.subjectId) conds.push(eq(schema.tasks.subjectId, q.subjectId));
    if (q.overdue) conds.push(and(eq(schema.tasks.status, 'open'), lt(schema.tasks.dueAt, new Date()))!);
    const where = and(...conds);
    const orderBy = asc(schema.tasks.dueAt);
    const offset = (q.page - 1) * q.pageSize;
    const countRow = await tenant.db.select({ count: sql<number>`count(*)::int` }).from(schema.tasks).where(where);
    const count = countRow[0]?.count ?? 0;
    const items = await tenant.db.select().from(schema.tasks).where(where).orderBy(orderBy).limit(q.pageSize).offset(offset);
    return paginate(items, count, q);
  });

  app.post('/tasks', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    if (!tenant.userId) throw badRequest('Tasks can only be created by a human user');
    const parsed = TaskCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const id = generateId(Prefixes.task);
    await tenant.db.insert(schema.tasks).values({
      id,
      organizationId: tenant.organizationId,
      title: body.title,
      description: body.description ?? null,
      dueAt: body.dueAt ? new Date(body.dueAt) : null,
      ownerId: body.ownerId ?? tenant.userId,
      subjectType: body.subjectType,
      subjectId: body.subjectId ?? null,
      priority: body.priority,
    });
    if (body.subjectType !== 'general' && body.subjectId) {
      await recordActivity(tenant, {
        type: 'task',
        subjectType: body.subjectType,
        subjectId: body.subjectId,
        title: `Tarea: ${body.title}`,
        metadata: { taskId: id },
      });
    }
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'task', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.patch('/tasks/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = TaskUpdate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      if (k === 'dueAt') updates.dueAt = v ? new Date(v as string) : null;
      else updates[k] = v;
    }
    if (body.status === 'done') updates.completedAt = new Date();
    if (body.status && body.status !== 'done') updates.completedAt = null;
    const res = await tenant.db
      .update(schema.tasks)
      .set(updates)
      .where(and(eq(schema.tasks.organizationId, tenant.organizationId), eq(schema.tasks.id, id)))
      .returning({ id: schema.tasks.id });
    if (!res.length) throw notFound('Task not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'task', resourceId: id });
    return { ok: true, id };
  });

  app.delete('/tasks/:id', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.tasks)
      .where(and(eq(schema.tasks.organizationId, tenant.organizationId), eq(schema.tasks.id, id)))
      .returning({ id: schema.tasks.id });
    if (!res.length) throw notFound('Task not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'task', resourceId: id });
    return reply.status(204).send();
  });
}
