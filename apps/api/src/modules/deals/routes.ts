import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes, PaginationQuery, paginate } from '@departify-crm/shared';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { recordActivity } from '../../activities/log.js';

const DealCreate = z.object({
  pipelineId: z.string().min(1),
  stageId: z.string().min(1),
  name: z.string().min(1).max(200),
  companyId: z.string().max(64).optional(),
  ownerId: z.string().max(64).optional(),
  /** Value in major units (e.g. euros). Stored as minor units. */
  value: z.number().nonnegative().default(0),
  currency: z.string().length(3).default('EUR'),
  probability: z.number().int().min(0).max(100).default(0),
  expectedCloseAt: z.string().datetime().optional(),
  source: z.string().max(120).optional(),
  contactIds: z.array(z.string()).max(50).default([]),
  customValues: z.record(z.unknown()).optional(),
});

const DealUpdate = z.object({
  name: z.string().min(1).max(200).optional(),
  companyId: z.string().max(64).nullable().optional(),
  ownerId: z.string().max(64).nullable().optional(),
  value: z.number().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  expectedCloseAt: z.string().datetime().nullable().optional(),
  source: z.string().max(120).nullable().optional(),
  customValues: z.record(z.unknown()).optional(),
});

const DealMove = z.object({
  stageId: z.string().min(1),
  position: z.number().int().min(0).optional(),
});

const DealList = z.object({
  ...PaginationQuery.shape,
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  status: z.enum(['open', 'won', 'lost', 'all']).default('open'),
  sort: z.enum(['created_at', 'updated_at', 'value_minor', 'expected_close_at']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export async function dealRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/deals', async (req) => {
    const tenant = req.tenant!;
    const q = DealList.parse(req.query);
    const conds = [eq(schema.deals.organizationId, tenant.organizationId)];
    if (q.pipelineId) conds.push(eq(schema.deals.pipelineId, q.pipelineId));
    if (q.stageId) conds.push(eq(schema.deals.stageId, q.stageId));
    if (q.status !== 'all') conds.push(eq(schema.deals.status, q.status));
    const where = and(...conds);
    const orderCol = (() => {
      switch (q.sort) {
        case 'created_at':
          return schema.deals.createdAt;
        case 'value_minor':
          return schema.deals.valueMinor;
        case 'expected_close_at':
          return schema.deals.expectedCloseAt;
        default:
          return schema.deals.updatedAt;
      }
    })();
    const orderBy = q.order === 'asc' ? asc(orderCol) : desc(orderCol);
    const offset = (q.page - 1) * q.pageSize;
    const countRow = await tenant.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.deals)
      .where(where);
    const count = countRow[0]?.count ?? 0;
    const items = await tenant.db
      .select()
      .from(schema.deals)
      .where(where)
      .orderBy(orderBy)
      .limit(q.pageSize)
      .offset(offset);
    return paginate(items, count, q);
  });

  app.post('/deals', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = DealCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;

    // Validate pipeline + stage belong to this org.
    const stage = (
      await tenant.db
        .select({ id: schema.stages.id, pipelineId: schema.stages.pipelineId, defaultProbability: schema.stages.defaultProbability })
        .from(schema.stages)
        .innerJoin(schema.pipelines, eq(schema.pipelines.id, schema.stages.pipelineId))
        .where(and(eq(schema.stages.id, body.stageId), eq(schema.stages.pipelineId, body.pipelineId), eq(schema.pipelines.organizationId, tenant.organizationId)))
        .limit(1)
    )[0];
    if (!stage) throw badRequest('Stage does not belong to the given pipeline or organization');

    const id = generateId(Prefixes.deal);
    const valueMinor = Math.round(body.value * 100);
    await tenant.db.insert(schema.deals).values({
      id,
      organizationId: tenant.organizationId,
      pipelineId: body.pipelineId,
      stageId: body.stageId,
      name: body.name,
      companyId: body.companyId ?? null,
      ownerId: body.ownerId ?? tenant.userId,
      valueMinor,
      currency: body.currency,
      probability: body.probability ?? stage.defaultProbability,
      expectedCloseAt: body.expectedCloseAt ? new Date(body.expectedCloseAt) : null,
      source: body.source ?? null,
      status: 'open',
      customValues: (body.customValues ?? {}) as Record<string, unknown>,
    });
    for (const cid of body.contactIds) {
      await tenant.db
        .insert(schema.dealContacts)
        .values({ organizationId: tenant.organizationId, dealId: id, contactId: cid, role: null })
        .onConflictDoNothing();
    }
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'deal', resourceId: id });
    await recordActivity(tenant, { type: 'deal_change', subjectType: 'deal', subjectId: id, title: 'Deal creado' });
    return reply.status(201).send({ id });
  });

  app.get('/deals/:id', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const rows = await tenant.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.id, id)))
      .limit(1);
    if (!rows.length) throw notFound('Deal not found');
    const deal = rows[0]!;
    const contacts = await tenant.db
      .select({
        id: schema.contacts.id,
        fullName: schema.contacts.fullName,
        email: schema.contacts.email,
        jobTitle: schema.contacts.jobTitle,
      })
      .from(schema.dealContacts)
      .innerJoin(schema.contacts, eq(schema.contacts.id, schema.dealContacts.contactId))
      .where(eq(schema.dealContacts.dealId, id));
    return { ...deal, contacts };
  });

  app.patch('/deals/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = DealUpdate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (body.value !== undefined) updates.valueMinor = Math.round(body.value * 100);
    for (const [k, v] of Object.entries(body)) {
      if (k === 'value') continue;
      if (v === undefined) continue;
      updates[k] = v;
    }
    const res = await tenant.db
      .update(schema.deals)
      .set(updates)
      .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.id, id)))
      .returning({ id: schema.deals.id });
    if (!res.length) throw notFound('Deal not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'deal', resourceId: id });
    return { ok: true, id };
  });

  app.post('/deals/:id/move', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = DealMove.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;

    const result = await tenant.db.transaction(async (tx) => {
      const dealRows = await tx
        .select({ id: schema.deals.id, pipelineId: schema.deals.pipelineId })
        .from(schema.deals)
        .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.id, id)))
        .limit(1);
      const deal = dealRows[0];
      if (!deal) throw notFound('Deal not found');

      const stageRows = await tx
        .select({
          id: schema.stages.id,
          isWon: schema.stages.isWon,
          isLost: schema.stages.isLost,
          defaultProbability: schema.stages.defaultProbability,
        })
        .from(schema.stages)
        .where(and(eq(schema.stages.id, body.stageId), eq(schema.stages.pipelineId, deal.pipelineId)))
        .limit(1);
      const stage = stageRows[0];
      if (!stage) throw badRequest('Target stage does not belong to the deal pipeline');

      const won = stage.isWon === 1;
      const lost = stage.isLost === 1;
      const now = new Date();
      await tx
        .update(schema.deals)
        .set({
          stageId: body.stageId,
          probability: stage.defaultProbability,
          status: won ? 'won' : lost ? 'lost' : 'open',
          wonAt: won ? now : null,
          lostAt: lost ? now : null,
          closedAt: won || lost ? now : null,
          updatedAt: now,
        })
        .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.id, id)));
      return { won, lost };
    });

    await audit(tenant.db, tenant, { action: 'update', resourceType: 'deal_stage', resourceId: id, metadata: { stageId: body.stageId } });
    await recordActivity(tenant, {
      type: 'status_change',
      subjectType: 'deal',
      subjectId: id,
      title: result.won ? 'Deal ganado' : result.lost ? 'Deal perdido' : 'Etapa actualizada',
    });
    return { ok: true };
  });

  app.delete('/deals/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.deals)
      .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.id, id)))
      .returning({ id: schema.deals.id });
    if (!res.length) throw notFound('Deal not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'deal', resourceId: id });
    return reply.status(204).send();
  });
}
