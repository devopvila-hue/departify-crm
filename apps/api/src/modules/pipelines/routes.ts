import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, eq, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes } from '@departify-crm/shared';
import { badRequest, notFound, conflict } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

const PipelineCreate = z.object({
  name: z.string().min(1).max(120),
  purpose: z.string().max(60).optional(),
  stages: z
    .array(
      z.object({
        name: z.string().min(1).max(60),
        defaultProbability: z.number().int().min(0).max(100).default(0),
        color: z.string().max(20).optional(),
        isWon: z.boolean().default(false),
        isLost: z.boolean().default(false),
      }),
    )
    .min(2)
    .max(20)
    .default([
      { name: 'Nuevo', defaultProbability: 5 },
      { name: 'Contactado', defaultProbability: 20 },
      { name: 'Propuesta', defaultProbability: 50 },
      { name: 'Ganado', defaultProbability: 100, isWon: true },
      { name: 'Perdido', defaultProbability: 0, isLost: true },
    ]),
});

const StageReorder = z.object({
  order: z.array(z.string().min(1)).min(1).max(40),
});

export async function pipelineRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/pipelines', async (req) => {
    const tenant = req.tenant!;
    const rows = await tenant.db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.organizationId, tenant.organizationId))
      .orderBy(asc(schema.pipelines.position));
    return rows;
  });

  app.post('/pipelines', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = PipelineCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;

    const existing = await tenant.db
      .select({ id: schema.pipelines.id })
      .from(schema.pipelines)
      .where(and(eq(schema.pipelines.organizationId, tenant.organizationId), eq(schema.pipelines.name, body.name)))
      .limit(1);
    if (existing.length) throw conflict('A pipeline with this name already exists');

    const pipelineId = generateId(Prefixes.pipeline);
    await tenant.db.insert(schema.pipelines).values({
      id: pipelineId,
      organizationId: tenant.organizationId,
      name: body.name,
      purpose: body.purpose ?? null,
      position: 0,
    });

    for (let i = 0; i < body.stages.length; i++) {
      const st = body.stages[i]!;
      await tenant.db.insert(schema.stages).values({
        id: generateId(Prefixes.stage),
        organizationId: tenant.organizationId,
        pipelineId,
        name: st.name,
        position: i,
        defaultProbability: st.defaultProbability,
        color: st.color ?? null,
        isWon: st.isWon ? 1 : 0,
        isLost: st.isLost ? 1 : 0,
      });
    }

    await audit(tenant.db, tenant, { action: 'create', resourceType: 'pipeline', resourceId: pipelineId });
    return reply.status(201).send({ id: pipelineId });
  });

  app.get('/pipelines/:id', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const rows = await tenant.db
      .select()
      .from(schema.pipelines)
      .where(and(eq(schema.pipelines.organizationId, tenant.organizationId), eq(schema.pipelines.id, id)))
      .limit(1);
    if (!rows.length) throw notFound('Pipeline not found');
    const stages = await tenant.db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.pipelineId, id))
      .orderBy(asc(schema.stages.position));
    return { ...rows[0], stages };
  });

  app.post('/pipelines/:id/stages/reorder', { preHandler: [requireRole('admin')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = StageReorder.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    await tenant.db.transaction(async (tx) => {
      const owned = await tx
        .select({ id: schema.pipelines.id })
        .from(schema.pipelines)
        .where(and(eq(schema.pipelines.organizationId, tenant.organizationId), eq(schema.pipelines.id, id)))
        .limit(1);
      if (!owned.length) throw notFound('Pipeline not found');
      for (let i = 0; i < body.order.length; i++) {
        const stageId = body.order[i]!;
        await tx
          .update(schema.stages)
          .set({ position: i, updatedAt: new Date() })
          .where(and(eq(schema.stages.id, stageId), eq(schema.stages.pipelineId, id)));
      }
    });
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'pipeline_stages', resourceId: id });
    return { ok: true };
  });

  // Kanban view — single call returns pipeline + stages + deals.
  app.get('/pipelines/:id/kanban', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const pipeline = (
      await tenant.db
        .select()
        .from(schema.pipelines)
        .where(and(eq(schema.pipelines.organizationId, tenant.organizationId), eq(schema.pipelines.id, id)))
        .limit(1)
    )[0];
    if (!pipeline) throw notFound('Pipeline not found');
    const stages = await tenant.db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.pipelineId, id))
      .orderBy(asc(schema.stages.position));
    const deals = await tenant.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, tenant.organizationId), eq(schema.deals.pipelineId, id)));
    return { pipeline, stages, deals };
  });

  // Ensure the org has at least one pipeline. Idempotent.
  app.post('/pipelines/ensure-default', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const existing = await tenant.db
      .select({ id: schema.pipelines.id })
      .from(schema.pipelines)
      .where(eq(schema.pipelines.organizationId, tenant.organizationId))
      .limit(1);
    if (existing.length) return reply.send({ id: existing[0]!.id, created: false });

    const pipelineId = generateId(Prefixes.pipeline);
    await tenant.db.insert(schema.pipelines).values({
      id: pipelineId,
      organizationId: tenant.organizationId,
      name: 'Ventas',
      purpose: 'sales',
    });
    const defaults = [
      { name: 'Nuevo', prob: 5 },
      { name: 'Contactado', prob: 20 },
      { name: 'Propuesta', prob: 50 },
      { name: 'Ganado', prob: 100, won: true },
      { name: 'Perdido', prob: 0, lost: true },
    ];
    for (let i = 0; i < defaults.length; i++) {
      const d = defaults[i]!;
      await tenant.db.insert(schema.stages).values({
        id: generateId(Prefixes.stage),
        organizationId: tenant.organizationId,
        pipelineId,
        name: d.name,
        position: i,
        defaultProbability: d.prob,
        isWon: d.won ? 1 : 0,
        isLost: d.lost ? 1 : 0,
      });
    }
    return reply.status(201).send({ id: pipelineId, created: true });
  });
  void sql; void requireRole;
}
