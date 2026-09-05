import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { and, eq, ilike, or } from 'drizzle-orm';
import { schema } from '@departify-crm/db';
import { badRequest } from '../../errors.js';

const SearchQuery = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(8),
});

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', async (req) => {
    if (!req.tenant) throw badRequest('Authentication required');
  });

  app.get('/search', async (req) => {
    const tenant = req.tenant!;
    const q = SearchQuery.parse(req.query);
    const term = `%${q.q}%`;

    const contacts = await tenant.db
      .select({
        id: schema.contacts.id,
        fullName: schema.contacts.fullName,
        email: schema.contacts.email,
        lifecycle: schema.contacts.lifecycle,
      })
      .from(schema.contacts)
      .where(
        and(
          eq(schema.contacts.organizationId, tenant.organizationId),
          or(ilike(schema.contacts.fullName, term), ilike(schema.contacts.email, term))!,
        ),
      )
      .limit(q.limit);

    const companies = await tenant.db
      .select({
        id: schema.companies.id,
        name: schema.companies.name,
        domain: schema.companies.domain,
        city: schema.companies.city,
      })
      .from(schema.companies)
      .where(
        and(
          eq(schema.companies.organizationId, tenant.organizationId),
          or(ilike(schema.companies.name, term), ilike(schema.companies.domain, term), ilike(schema.companies.city, term))!,
        ),
      )
      .limit(q.limit);

    const deals = await tenant.db
      .select({
        id: schema.deals.id,
        name: schema.deals.name,
        valueMinor: schema.deals.valueMinor,
        currency: schema.deals.currency,
        status: schema.deals.status,
      })
      .from(schema.deals)
      .where(
        and(
          eq(schema.deals.organizationId, tenant.organizationId),
          ilike(schema.deals.name, term),
        ),
      )
      .limit(q.limit);

    return { contacts, companies, deals, tookMs: 0 };
  });
}
