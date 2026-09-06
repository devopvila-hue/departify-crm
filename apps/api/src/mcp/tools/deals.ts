/**
 * MCP tools — deals + pipelines.
 */
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { generateId, Prefixes } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';
import { errOut, jsonOut } from './_out.js';

// ─── Pipelines + stages (read-mostly; created via the UI) ─────────────

const ListPipelinesInput = z.object({});

export function registerPipelineTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_pipelines', 'List the pipelines (with their stages) configured for this org.', ListPipelinesInput.shape, async () => {
    const { db, org } = ctx;
    const pipelines = await db
      .select()
      .from(schema.pipelines)
      .where(eq(schema.pipelines.organizationId, org.organizationId))
      .orderBy(desc(schema.pipelines.createdAt));
    const stages = await db
      .select()
      .from(schema.stages)
      .where(eq(schema.stages.organizationId, org.organizationId))
      .orderBy(schema.stages.position);
    const byPipeline = new Map<string, typeof stages>();
    for (const s of stages) {
      const arr = byPipeline.get(s.pipelineId) ?? [];
      arr.push(s);
      byPipeline.set(s.pipelineId, arr);
    }
    return jsonOut(pipelines.map((p) => ({ ...p, stages: byPipeline.get(p.id) ?? [] })));
  });
}

// ─── Deals ───────────────────────────────────────────────────────────

const ListDealsInput = z.object({
  pipelineId: z.string().optional(),
  stageId: z.string().optional(),
  status: z.enum(['open', 'won', 'lost']).optional(),
  ownerId: z.string().optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const GetDealInput = z.object({ id: z.string() });
const CreateDealInput = z.object({
  name: z.string().min(1).max(200),
  pipelineId: z.string(),
  stageId: z.string(),
  /** Value in MAJOR units (e.g. 12.50 EUR). Stored as minor units. */
  amount: z.number().nonnegative().optional(),
  currency: z.string().length(3).default('EUR'),
  companyId: z.string().optional(),
  ownerId: z.string().optional(),
  expectedCloseAt: z.string().datetime().optional(),
  source: z.string().max(80).optional(),
  status: z.enum(['open', 'won', 'lost']).default('open'),
});
const UpdateDealInput = z.object({
  id: z.string(),
  patch: z
    .object({
      name: z.string().min(1).max(200).optional(),
      stageId: z.string().optional(),
      amount: z.number().nonnegative().nullable().optional(),
      currency: z.string().length(3).optional(),
      companyId: z.string().nullable().optional(),
      ownerId: z.string().nullable().optional(),
      expectedCloseAt: z.string().datetime().nullable().optional(),
      source: z.string().max(80).nullable().optional(),
      status: z.enum(['open', 'won', 'lost']).optional(),
    })
    .strict(),
});
const DeleteDealInput = z.object({ id: z.string() });

export function registerDealTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_deals', 'List deals with filters and pagination.', ListDealsInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.deals.organizationId, org.organizationId)];
    if (a.pipelineId) conds.push(eq(schema.deals.pipelineId, a.pipelineId));
    if (a.stageId) conds.push(eq(schema.deals.stageId, a.stageId));
    if (a.status) conds.push(eq(schema.deals.status, a.status));
    if (a.ownerId) conds.push(eq(schema.deals.ownerId, a.ownerId));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.deals)
      .where(and(...conds))
      .orderBy(desc(schema.deals.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    const totalRow = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.deals)
      .where(and(...conds));
    return jsonOut({ items, total: totalRow[0]?.c ?? 0, page: a.page, pageSize: a.pageSize });
  });
  server.tool('get_deal', 'Get a deal by id.', GetDealInput.shape, async (a) => {
    const rows = await ctx.db
      .select()
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, ctx.org.organizationId), eq(schema.deals.id, a.id)))
      .limit(1);
    if (!rows[0]) return errOut('NOT_FOUND');
    return jsonOut(rows[0]);
  });
  server.tool('create_deal', 'Create a deal. Returns the new id.', CreateDealInput.shape, async (a) => {
    const id = generateId(Prefixes.deal);
    await ctx.db.insert(schema.deals).values({
      id,
      organizationId: ctx.org.organizationId,
      name: a.name,
      pipelineId: a.pipelineId,
      stageId: a.stageId,
      valueMinor: Math.round((a.amount ?? 0) * 100),
      currency: a.currency,
      companyId: a.companyId ?? null,
      ownerId: a.ownerId ?? null,
      expectedCloseAt: a.expectedCloseAt ? new Date(a.expectedCloseAt) : null,
      source: a.source ?? null,
      status: a.status,
    });
    return jsonOut({ id });
  });
  server.tool('update_deal', 'Patch a deal. `amount` is in major units (e.g. 12.50).', UpdateDealInput.shape, async (a) => {
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(a.patch)) {
      if (v === undefined) continue;
      if (k === 'amount') {
        updates['valueMinor'] = v === null ? 0 : Math.round(Number(v) * 100);
      } else if (k === 'expectedCloseAt') {
        updates[k] = typeof v === 'string' ? new Date(v) : null;
      } else {
        updates[k] = v;
      }
    }
    const res = await ctx.db
      .update(schema.deals)
      .set(updates)
      .where(and(eq(schema.deals.organizationId, ctx.org.organizationId), eq(schema.deals.id, a.id)))
      .returning({ id: schema.deals.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
  server.tool('delete_deal', 'Delete a deal.', DeleteDealInput.shape, async (a) => {
    const res = await ctx.db
      .delete(schema.deals)
      .where(and(eq(schema.deals.organizationId, ctx.org.organizationId), eq(schema.deals.id, a.id)))
      .returning({ id: schema.deals.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}
