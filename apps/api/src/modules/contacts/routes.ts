import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { schema, createDb } from '@departify-crm/db';
import { generateId, Prefixes, PaginationQuery, paginate, FilterBody } from '@departify-crm/shared';
import { compileFilter } from '../../lib/filter.js';
import { badRequest, notFound } from '../../errors.js';
import { requireRole } from '../../tenants/plugin.js';
import { audit } from '../../audit/log.js';
import { recordActivity } from '../../activities/log.js';
import { assertOwned } from '../../lib/ownership.js';
import { config } from '../../config.js';

const ContactCreate = z.object({
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  fullName: z.string().min(1).max(240),
  email: z.string().email().max(254).optional().or(z.literal('')),
  phone: z.string().max(40).optional().or(z.literal('')),
  jobTitle: z.string().max(120).optional().or(z.literal('')),
  companyId: z.string().max(64).optional(),
  lifecycle: z.enum(['lead', 'prospect', 'customer', 'partner', 'archived']).default('lead'),
  source: z.string().max(120).optional(),
  ownerId: z.string().max(64).optional(),
  customValues: z.record(z.unknown()).optional(),
});

const ContactUpdate = ContactCreate.partial();

const ContactList = z.object({
  ...PaginationQuery.shape,
  search: z.string().max(200).optional(),
  companyId: z.string().max(64).optional(),
  filter: z.unknown().optional(),
  sort: z.enum(['created_at', 'updated_at', 'last_activity_at', 'full_name']).default('updated_at'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const allowedContactFields = {
  lifecycle: sql`lifecycle`,
  source: sql`source`,
  country: sql`country`,
  city: sql`city`,
  owner_id: sql`owner_id`,
  company_id: sql`company_id`,
  last_activity_at: sql`last_activity_at`,
  created_at: sql`created_at`,
} as const;

function compileFilterFromBody(body: unknown): { filter?: unknown; search?: string } | undefined {
  const parsed = FilterBody.safeParse(body);
  if (!parsed.success) return undefined;
  return parsed.data;
}

export async function contactRoutes(app: FastifyInstance) {
  // All contact routes require authentication. The preHandler runs after
  // the global tenant attach hook; if it isn't attached we return 401.
  app.addHook('preHandler', async (req, _reply) => {
    if (!req.tenant) {
      const err = (req as unknown as { _authError?: Error })._authError;
      if (err) throw err;
      throw badRequest('Authentication required');
    }
  });

  app.get('/contacts', async (req) => {
    const tenant = req.tenant!;
    const q = ContactList.parse(req.query);
    const filter = compileFilterFromBody(q.filter);

    const conds = [eq(schema.contacts.organizationId, tenant.organizationId)];
    if (q.companyId) conds.push(eq(schema.contacts.companyId, q.companyId));
    if (q.search) {
      const s = `%${q.search}%`;
      conds.push(
        or(
          ilike(schema.contacts.fullName, s),
          ilike(schema.contacts.email, s),
          ilike(schema.contacts.phone, s),
          ilike(schema.contacts.jobTitle, s),
        )!,
      );
    }
    if (filter?.filter) {
      const compiled = compileFilter(filter.filter as never, allowedContactFields as never, eq(schema.contacts.organizationId, tenant.organizationId));
      if (compiled) conds.push(compiled);
    }

    const where = and(...conds);

    const orderCol = (() => {
      switch (q.sort) {
        case 'created_at':
          return schema.contacts.createdAt;
        case 'updated_at':
          return schema.contacts.updatedAt;
        case 'last_activity_at':
          return schema.contacts.lastActivityAt;
        case 'full_name':
          return schema.contacts.fullName;
      }
    })();
    const orderBy = q.order === 'asc' ? asc(orderCol) : desc(orderCol);

    const offset = (q.page - 1) * q.pageSize;
    const countRow = await tenant.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.contacts)
      .where(where);
    const count = countRow[0]?.count ?? 0;
    const items = await tenant.db
      .select()
      .from(schema.contacts)
      .where(where)
      .orderBy(orderBy)
      .limit(q.pageSize)
      .offset(offset);

    return paginate(items, count, q);
  });

  app.post('/contacts', { preHandler: [requireRole('member')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const parsed = ContactCreate.safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid contact body', { issues: parsed.error.flatten() });
    const body = parsed.data;
    if (body.companyId) await assertOwned(tenant, 'company', body.companyId);
    const id = generateId(Prefixes.contact);
    const now = new Date();
    await tenant.db.insert(schema.contacts).values({
      id,
      organizationId: tenant.organizationId,
      firstName: body.firstName || null,
      lastName: body.lastName || null,
      fullName: body.fullName,
      email: body.email || null,
      phone: body.phone || null,
      jobTitle: body.jobTitle || null,
      companyId: body.companyId || null,
      lifecycle: body.lifecycle,
      source: body.source || null,
      ownerId: body.ownerId || tenant.userId,
      customValues: (body.customValues ?? {}) as Record<string, unknown>,
      createdAt: now,
      updatedAt: now,
    });
    await audit(tenant.db, tenant, { action: 'create', resourceType: 'contact', resourceId: id });
    await recordActivity(tenant, {
      type: 'system_event',
      subjectType: 'contact',
      subjectId: id,
      title: 'Contacto creado',
    });
    return reply.status(201).send({ id });
  });

  app.get('/contacts/:id', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const rows = await tenant.db
      .select()
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)))
      .limit(1);
    const row = rows[0];
    if (!row) throw notFound('Contact not found');
    return row;
  });

  app.patch('/contacts/:id', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = ContactUpdate.parse(req.body);
    if (body.companyId) await assertOwned(tenant, 'company', body.companyId);
    const updates: Record<string, unknown> = { updatedAt: new Date() };
    for (const [k, v] of Object.entries(body)) {
      if (v === undefined) continue;
      updates[k] = v === '' ? null : v;
    }
    const res = await tenant.db
      .update(schema.contacts)
      .set(updates)
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)))
      .returning({ id: schema.contacts.id });
    if (!res.length) throw notFound('Contact not found');
    await audit(tenant.db, tenant, { action: 'update', resourceType: 'contact', resourceId: id, metadata: { fields: Object.keys(body) } });
    return { ok: true, id };
  });

  app.delete('/contacts/:id', { preHandler: [requireRole('admin')] }, async (req, reply) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const res = await tenant.db
      .delete(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)))
      .returning({ id: schema.contacts.id });
    if (!res.length) throw notFound('Contact not found');
    await audit(tenant.db, tenant, { action: 'delete', resourceType: 'contact', resourceId: id });
    return reply.status(204).send();
  });

  // POST /contacts/:id/public-card — enable/disable the shareable
  // /c/:slug card. The slug is auto-generated from the contact id
  // plus a short random suffix, so it's stable but unguessable.
  app.post('/contacts/:id/public-card', { preHandler: [requireRole('member')] }, async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    const body = z.object({ enabled: z.boolean() }).parse(req.body ?? {});
    const db = createDb(config.DATABASE_URL);
    if (!body.enabled) {
      await db
        .update(schema.contacts)
        .set({ publicSlug: null })
        .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)));
      return { enabled: false, slug: null, url: null };
    }
    const slug = `${id.replace(/^con_/, '').toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`;
    await db
      .update(schema.contacts)
      .set({ publicSlug: slug })
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)));
    const host = config.PUBLIC_HOSTNAME.startsWith('http') ? config.PUBLIC_HOSTNAME : `https://${config.PUBLIC_HOSTNAME}`;
    return { enabled: true, slug, url: `${host}/c/${slug}` };
  });

  app.get('/contacts/:id/timeline', async (req) => {
    const tenant = req.tenant!;
    const id = z.string().parse((req.params as { id: string }).id);
    // Confirm tenant ownership first.
    const owned = await tenant.db
      .select({ id: schema.contacts.id })
      .from(schema.contacts)
      .where(and(eq(schema.contacts.organizationId, tenant.organizationId), eq(schema.contacts.id, id)))
      .limit(1);
    if (!owned.length) throw notFound('Contact not found');
    const activities = await tenant.db
      .select()
      .from(schema.activities)
      .where(
        and(
          eq(schema.activities.organizationId, tenant.organizationId),
          eq(schema.activities.subjectType, 'contact'),
          eq(schema.activities.subjectId, id),
        ),
      )
      .orderBy(desc(schema.activities.createdAt))
      .limit(200);
    const notes = await tenant.db
      .select()
      .from(schema.notes)
      .where(
        and(
          eq(schema.notes.organizationId, tenant.organizationId),
          eq(schema.notes.subjectType, 'contact'),
          eq(schema.notes.subjectId, id),
        ),
      )
      .orderBy(desc(schema.notes.createdAt))
      .limit(200);
    return { activities, notes };
  });
}
