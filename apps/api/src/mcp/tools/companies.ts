/**
 * MCP tools — companies.
 */
import { z } from 'zod';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { generateId, Prefixes } from '@departify-crm/shared';
import { schema, type Database } from '@departify-crm/db';
import type { McpOrgContext } from '../auth.js';

const ListInput = z.object({
  search: z.string().max(200).optional(),
  status: z.enum(['active', 'inactive', 'archived']).optional(),
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(200).default(50),
});
const GetInput = z.object({ id: z.string() });
const CreateInput = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional(),
  website: z.string().url().max(500).optional(),
  industry: z.string().max(80).optional(),
  size: z.string().max(40).optional(),
  country: z.string().max(80).optional(),
  city: z.string().max(80).optional(),
  postalCode: z.string().max(20).optional(),
  address: z.string().max(300).optional(),
  phone: z.string().max(40).optional(),
  ownerId: z.string().optional(),
  source: z.string().max(80).optional(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
});
const UpdateInput = z.object({
  id: z.string(),
  patch: z
    .object({
      name: z.string().min(1).max(200).optional(),
      domain: z.string().max(200).nullable().optional(),
      website: z.string().url().max(500).nullable().optional(),
      industry: z.string().max(80).nullable().optional(),
      size: z.string().max(40).nullable().optional(),
      country: z.string().max(80).nullable().optional(),
      city: z.string().max(80).nullable().optional(),
      postalCode: z.string().max(20).nullable().optional(),
      address: z.string().max(300).nullable().optional(),
      phone: z.string().max(40).nullable().optional(),
      ownerId: z.string().nullable().optional(),
      source: z.string().max(80).nullable().optional(),
      status: z.enum(['active', 'inactive', 'archived']).optional(),
    })
    .strict(),
});
const DeleteInput = z.object({ id: z.string() });

export function registerCompanyTools(
  server: import('@modelcontextprotocol/sdk/server/mcp.js').McpServer,
  ctx: { db: Database; org: McpOrgContext },
): void {
  server.tool('list_companies', 'List companies in this org with optional search, status and pagination.', ListInput.shape, async (a) => {
    const { db, org } = ctx;
    const conds = [eq(schema.companies.organizationId, org.organizationId)];
    if (a.search) {
      const q = `%${a.search}%`;
      conds.push(or(ilike(schema.companies.name, q), ilike(schema.companies.domain, q))!);
    }
    if (a.status) conds.push(eq(schema.companies.status, a.status));
    const offset = (a.page - 1) * a.pageSize;
    const items = await db
      .select()
      .from(schema.companies)
      .where(and(...conds))
      .orderBy(desc(schema.companies.createdAt))
      .limit(a.pageSize)
      .offset(offset);
    const totalRow = await db
      .select({ c: sql<number>`count(*)::int` })
      .from(schema.companies)
      .where(and(...conds));
    return jsonOut({ items, total: totalRow[0]?.c ?? 0, page: a.page, pageSize: a.pageSize });
  });

  server.tool('get_company', 'Get a company by id.', GetInput.shape, async (a) => {
    const { db, org } = ctx;
    const rows = await db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.organizationId, org.organizationId), eq(schema.companies.id, a.id)))
      .limit(1);
    if (!rows[0]) return errOut('NOT_FOUND');
    return jsonOut(rows[0]);
  });

  server.tool('create_company', 'Create a company. Returns the new id.', CreateInput.shape, async (a) => {
    const { db, org } = ctx;
    const id = generateId(Prefixes.company);
    await db.insert(schema.companies).values({
      id,
      organizationId: org.organizationId,
      name: a.name,
      domain: a.domain ?? null,
      website: a.website ?? null,
      industry: a.industry ?? null,
      size: a.size ?? null,
      country: a.country ?? null,
      city: a.city ?? null,
      postalCode: a.postalCode ?? null,
      address: a.address ?? null,
      phone: a.phone ?? null,
      ownerId: a.ownerId ?? null,
      source: a.source ?? null,
      status: a.status,
    });
    return jsonOut({ id });
  });

  server.tool('update_company', 'Patch a company. Only fields in `patch` are written.', UpdateInput.shape, async (a) => {
    const { db, org } = ctx;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(a.patch)) if (v !== undefined) updates[k] = v;
    const res = await db
      .update(schema.companies)
      .set(updates)
      .where(and(eq(schema.companies.organizationId, org.organizationId), eq(schema.companies.id, a.id)))
      .returning({ id: schema.companies.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });

  server.tool('delete_company', 'Delete a company by id.', DeleteInput.shape, async (a) => {
    const { db, org } = ctx;
    const res = await db
      .delete(schema.companies)
      .where(and(eq(schema.companies.organizationId, org.organizationId), eq(schema.companies.id, a.id)))
      .returning({ id: schema.companies.id });
    if (!res.length) return errOut('NOT_FOUND');
    return jsonOut({ ok: true, id: res[0]!.id });
  });
}

function jsonOut(payload: unknown): { content: Array<{ type: 'text'; text: string }> } {
  return { content: [{ type: 'text', text: JSON.stringify(payload) }] };
}
function errOut(code: string): { content: Array<{ type: 'text'; text: string }>; isError: true } {
  return { content: [{ type: 'text', text: JSON.stringify({ error: code }) }], isError: true };
}
