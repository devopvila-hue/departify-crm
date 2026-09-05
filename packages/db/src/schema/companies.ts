import {
  pgTable,
  text,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './users.js';
import { orgId } from './_helpers.js';

export const companyStatusEnum = pgEnum('company_status', ['active', 'inactive', 'archived']);

export const companies = pgTable(
  'companies',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    domain: text('domain'),
    website: text('website'),
    industry: text('industry'),
    size: text('size'),
    country: text('country'),
    city: text('city'),
    postalCode: text('postal_code'),
    address: text('address'),
    phone: text('phone'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    source: text('source'),
    status: companyStatusEnum('status').notNull().default('active'),
    customValues: jsonb('custom_values').$type<Record<string, unknown>>().notNull().default({}),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('companies_org_idx').on(t.organizationId),
    orgDomainUq: uniqueIndex('companies_org_domain_uq')
      .on(t.organizationId, t.domain)
      .where(sql`domain IS NOT NULL`),
    orgNameIdx: index('companies_org_name_idx').on(t.organizationId, t.name),
  }),
);

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
