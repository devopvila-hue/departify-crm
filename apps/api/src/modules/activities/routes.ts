/**
 * Activities feed — additive endpoint for the activity timeline.
 *
 * Read-only, tenant-scoped. Filters by subjectType + subjectId. Powers
 * the Company / Person / Deal timeline surfaces in Vertical 1.
 *
 * This is a NEW endpoint — no existing contract is changed.
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { paginate, PaginationQuery } from '@departify-crm/shared';
import { badRequest } from '../../errors.js';

const ListQuery = PaginationQuery.extend({
  subjectType: z.enum(['contact', 'company', 'deal', 'organization']).optional(),
  subjectId: z.string().min(1).max(64).optional(),
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

    return paginate(items, count, q);
  });
}
