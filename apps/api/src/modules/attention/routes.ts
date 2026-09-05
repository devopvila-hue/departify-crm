import type { FastifyInstance } from 'fastify';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { badRequest } from '../../errors.js';

/**
 * GET /api/v1/attention — the operational home of the CRM.
 *
 * Returns a small, actionable snapshot instead of a dashboard of
 * vanity metrics. Everything here answers "what needs attention?".
 */
export async function attentionRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/attention', async (req) => {
    const tenant = req.tenant!;
    const now = new Date();
    const orgId = tenant.organizationId;

    const overdueTasks = await tenant.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueAt: schema.tasks.dueAt,
        priority: schema.tasks.priority,
        subjectType: schema.tasks.subjectType,
        subjectId: schema.tasks.subjectId,
      })
      .from(schema.tasks)
      .where(and(eq(schema.tasks.organizationId, orgId), eq(schema.tasks.status, 'open'), lt(schema.tasks.dueAt, now)))
      .orderBy(asc(schema.tasks.dueAt))
      .limit(20);

    const todayTasks = await tenant.db
      .select({
        id: schema.tasks.id,
        title: schema.tasks.title,
        dueAt: schema.tasks.dueAt,
        priority: schema.tasks.priority,
      })
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.organizationId, orgId),
          eq(schema.tasks.status, 'open'),
          sql`due_at >= ${now.toISOString()}::timestamptz AND due_at < (${now.toISOString()}::timestamptz + interval '1 day')`,
        ),
      )
      .orderBy(asc(schema.tasks.dueAt))
      .limit(20);

    const staleDeals = await tenant.db
      .select({
        id: schema.deals.id,
        name: schema.deals.name,
        valueMinor: schema.deals.valueMinor,
        currency: schema.deals.currency,
        updatedAt: schema.deals.updatedAt,
        stageId: schema.deals.stageId,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.organizationId, orgId),
          eq(schema.deals.status, 'open'),
          sql`updated_at < (now() - interval '14 days')`,
        ),
      )
      .orderBy(asc(schema.deals.updatedAt))
      .limit(20);

    const recentContacts = await tenant.db
      .select({
        id: schema.contacts.id,
        fullName: schema.contacts.fullName,
        email: schema.contacts.email,
        lifecycle: schema.contacts.lifecycle,
        createdAt: schema.contacts.createdAt,
      })
      .from(schema.contacts)
      .where(eq(schema.contacts.organizationId, orgId))
      .orderBy(desc(schema.contacts.createdAt))
      .limit(10);

    const summary1 = await tenant.db
      .select({
        openDeals: sql<number>`count(*)::int`,
        pipelineValueMinor: sql<number>`coalesce(sum(value_minor), 0)::int`,
      })
      .from(schema.deals)
      .where(and(eq(schema.deals.organizationId, orgId), eq(schema.deals.status, 'open')));
    const openDeals = summary1[0]?.openDeals ?? 0;
    const pipelineValueMinor = summary1[0]?.pipelineValueMinor ?? 0;

    // Use a single LEFT JOIN on a guaranteed-1 row (the first open deal)
    // so we can compute the three totals in one round-trip without a
    // dummy table.
    const summary2 = await tenant.db
      .select({
        contactsTotal: sql<number>`(select count(*) from contacts where organization_id = ${orgId})::int`,
        companiesTotal: sql<number>`(select count(*) from companies where organization_id = ${orgId})::int`,
        tasksOpen: sql<number>`(select count(*) from tasks where organization_id = ${orgId} and status = 'open')::int`,
      })
      .from(schema.deals)
      .limit(1);
    const contactsTotal = summary2[0]?.contactsTotal ?? 0;
    const companiesTotal = summary2[0]?.companiesTotal ?? 0;
    const tasksOpen = summary2[0]?.tasksOpen ?? 0;

    return {
      generatedAt: now.toISOString(),
      summary: {
        openDeals,
        pipelineValueMinor,
        contactsTotal,
        companiesTotal,
        tasksOpen,
      },
      overdueTasks,
      todayTasks,
      staleDeals,
      recentContacts,
    };
  });
}
