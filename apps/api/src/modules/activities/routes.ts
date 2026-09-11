/**
 * Activities feed — global timeline for the CRM (tab "Actividad").
 *
 * Read-only, tenant-scoped. Returns the organization's activity events
 * (optionally filtered by subject or type), enriched with the display
 * name of each event's subject (company / contact / deal / organization)
 * and of the acting user, so the UI can render a self-contained
 * timeline without extra round-trips.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { paginate, PaginationQuery } from '@departify-crm/shared';
import { badRequest } from '../../errors.js';
import type { TenantContext } from '../../tenants/context.js';

const ListQuery = PaginationQuery.extend({
  subjectType: z.enum(['contact', 'company', 'deal', 'organization']).optional(),
  subjectId: z.string().min(1).max(64).optional(),
  type: z
    .enum(['note', 'email', 'call', 'meeting', 'task', 'status_change', 'deal_change', 'sequence_event', 'system_event'])
    .optional(),
});

export async function activityRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/activities', async (req) => {
    const tenant = req.tenant!;
    const q = ListQuery.parse(req.query);

    if (q.subjectId && !q.subjectType) {
      throw badRequest('subjectType is required when subjectId is provided');
    }

    const conds = [eq(schema.activities.organizationId, tenant.organizationId)];
    if (q.subjectType) conds.push(eq(schema.activities.subjectType, q.subjectType));
    if (q.subjectId) conds.push(eq(schema.activities.subjectId, q.subjectId));
    if (q.type) conds.push(eq(schema.activities.type, q.type));

    const where = and(...conds);
    const offset = (q.page - 1) * q.pageSize;

    const countRow = await tenant.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.activities)
      .where(where);
    const count = countRow[0]?.count ?? 0;

    const items = await tenant.db
      .select()
      .from(schema.activities)
      .where(where)
      .orderBy(desc(schema.activities.createdAt))
      .limit(q.pageSize)
      .offset(offset);

    // Enrich each event with the display name of its subject and actor.
    // Batched lookups (no N+1): one query per referenced entity kind.
    const names = await resolveSubjectNames(tenant, items);

    const enriched = items.map((a) => ({
      ...a,
      subjectName: names.subjects[a.subjectType]?.[a.subjectId] ?? null,
      actorName: names.actors[a.actorId ?? ''] ?? null,
    }));

    return paginate(enriched, count, q);
  });
}

/** Resolves subject + actor display names for a page of activities. */
async function resolveSubjectNames(ctx: Pick<TenantContext, 'organizationId' | 'db'>, items: Array<{ subjectType: string; subjectId: string; actorId: string | null }>) {
  const tenant = ctx;
  const subjects: Record<string, Record<string, string>> = {};
  const actors: Record<string, string> = {};

  const bucket = (type: string) => {
    subjects[type] ??= {};
    return subjects[type]!;
  };

  // Collect referenced ids per kind.
  const companyIds = new Set<string>();
  const contactIds = new Set<string>();
  const dealIds = new Set<string>();
  const actorIds = new Set<string>();
  for (const a of items) {
    if (a.subjectType === 'company') companyIds.add(a.subjectId);
    if (a.subjectType === 'contact') contactIds.add(a.subjectId);
    if (a.subjectType === 'deal') dealIds.add(a.subjectId);
    if (a.actorId) actorIds.add(a.actorId);
  }

  if (companyIds.size) {
    const rows = await tenant.db.select({ id: schema.companies.id, name: schema.companies.name }).from(schema.companies).where(and(eq(schema.companies.organizationId, tenant.organizationId), inArray(schema.companies.id, [...companyIds])));
    for (const r of rows) bucket('company')[r.id] = r.name;
  }
  if (contactIds.size) {
    const rows = await tenant.db.select({ id: schema.contacts.id, fullName: schema.contacts.fullName }).from(schema.contacts).where(and(eq(schema.contacts.organizationId, tenant.organizationId), inArray(schema.contacts.id, [...contactIds])));
    for (const r of rows) bucket('contact')[r.id] = r.fullName;
  }
  if (dealIds.size) {
    const rows = await tenant.db.select({ id: schema.deals.id, name: schema.deals.name }).from(schema.deals).where(and(eq(schema.deals.organizationId, tenant.organizationId), inArray(schema.deals.id, [...dealIds])));
    for (const r of rows) bucket('deal')[r.id] = r.name;
  }
  // Organization subjects reference the tenant's own org.
  const orgSubjects = items.filter((a) => a.subjectType === 'organization');
  if (orgSubjects.length) {
    const rows = await tenant.db.select({ id: schema.organizations.id, name: schema.organizations.name }).from(schema.organizations).where(inArray(schema.organizations.id, [...new Set(orgSubjects.map((a) => a.subjectId))]));
    for (const r of rows) bucket('organization')[r.id] = r.name;
  }
  if (actorIds.size) {
    const rows = await tenant.db.select({ id: schema.users.id, displayName: schema.users.displayName }).from(schema.users).where(inArray(schema.users.id, [...actorIds]));
    for (const r of rows) actors[r.id] = r.displayName;
  }

  return { subjects, actors };
}