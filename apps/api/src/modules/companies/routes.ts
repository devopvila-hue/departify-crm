import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { generateId, Prefixes, PaginationQuery, paginate, FilterBody } from '@departify-crm/shared';
import { compileFilter } from '../../lib/filter.js';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';

const CompanyCreate = z.object({
  name: z.string().min(1).max(200),
  domain: z.string().max(200).optional().or(z.literal('')),
  website: z.string().url().max(400).optional().or(z.literal('')),
  industry: z.string().max(120).optional().or(z.literal('')),
  size: z.string().max(40).optional().or(z.literal('')),
  country: z.string().max(80).optional().or(z.literal('')),
  city: z.string().max(120).optional().or(z.literal('')),
  postalCode: z.string().max(40).optional().or(z.literal('')),
  address: z.string().max(400).optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  source: z.string().max(120).optional().or(z.literal('')),
  ownerId: z.string().max(64).optional(),
  status: z.enum(['active', 'inactive', 'archived']).default('active'),
  customValues: z.record(z.unknown()).optional(),
});

const CompanyUpdate = CompanyCreate.partial();

const CompanyList = z.object({
  ...PaginationQuery.shape,
  search: z.string().max(200).optional(),
  filter: z.unknown().optional(),
  sort: z.enum(['created_at', 'updated_at', 'name']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const allowedCompanyFields = {
  status: sql`status`,
  industry: sql`industry`,
  country: sql`country`,
  city: sql`city`,
  owner_id: sql`owner_id`,
  created_at: sql`created_at`,
} as const;

export async function companyRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/companies', async (req) => {
    const tenant = req.tenant!;
    const q = CompanyList.parse(req.query);
    const conds = [eq(schema.companies.organizationId, tenant.organizationId)];
    if (q.search) {
      const s = `%${q.search}%`;
      conds.push(
        or(
          ilike(schema.companies.name, s),
          ilike(schema.companies.domain, s),
          ilike(schema.companies.city, s),
          ilike(schema.companies.industry, s),
        )!,
      );
    }
    const parsed = FilterBody.safeParse(q.filter);
    if (parsed.success && parsed.data.filter) {
      const compiled = compileFilter(
        parsed.data.filter as never,
        allowedCompanyFields as never,
        eq(schema.companies.organizationId, tenant.organizationId),
      );
      if (compiled) conds.push(compiled);
    }
    const where = and(...conds);
    const orderCol = q.sort === 'name' ? schema.companies.name : q.sort === 'created_at' ? schema.companies.createdAt : schema.companies.updatedAt;
    const orderBy = q.order === 'asc' ? asc(orderCol) : desc(orderCol);
    const offset = (q.page - 1) * q.pageSize;
    const countRow = await tenant.db.select({ count: sql<number>`count(*)::int` }).from(schema.companies).where(where);
    const count = countRow[0]?.count ?? 0;
    const items = await tenant.db.select().from(schema.companies).where(where).orderBy(orderBy).limit(q.pageSize).offset(offset);
    return paginate(items, count, q);
  });

  app.post('/companies', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = CompanyCreate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const id = generateId(Prefixes.company);
    await tenant.db.insert(schema.companies).values({
      id,
      organizationId: tenant.organizationId,
      name: body.name,
      domain: body.domain || null,
      website: body.website || null,
      industry: body.industry || null,
      size: body.size || null,
      country: body.country || null,
      city: body.city || null,
      postalCode: body.postalCode || null,
      address: body.address || null,
      phone: body.phone || null,
      ownerId: body.ownerId || tenant.userId,
      source: body.source || null,
      status: body.status,
      customValues: (body.customValues ?? {}) as Record<string, unknown>,
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'company', resourceId: id });
    return reply.status(201).send({ id });
  });

  app.get('/companies/:id', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const rows = await tenant.db
      .select()
      .from(schema.companies)
      .where(and(eq(schema.companies.organizationId, tenant.organizationId), eq(schema.companies.id, id)))
      .limit(1);
    if (!rows.length) throw notFound('Company not found');
    return rows[0];
  });

  app.patch('/companies/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const parsed = CompanyUpdate.safeParse(req.body); if (!parsed.success) throw badRequest('Invalid body', { issues: parsed.error.flatten() }); const body = parsed.data;
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v === '' ? null : v;
    }
    const res = await tenant.db
      .update(schema.companies)
      .set(updates)
      .where(and(eq(schema.companies.organizationId, tenant.organizationId), eq(schema.companies.id, id)))
      .returning({ id: schema.companies.id });
    if (!res.length) throw notFound('Company not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'company', resourceId: id });
    return { ok: true, id };
  });

  app.delete('/companies/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.companies)
      .where(and(eq(schema.companies.organizationId, tenant.organizationId), eq(schema.companies.id, id)))
      .returning({ id: schema.companies.id });
    if (!res.length) throw notFound('Company not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'company', resourceId: id });
    return reply.status(204).send();
  });
}
