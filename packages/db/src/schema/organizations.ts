import { pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const organizations = pgTable(
  'organizations',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Stable id used by external systems (e.g. DEPARTIFY org id) to map onto this CRM org. */
    externalId: text('external_id'),
    slug: text('slug').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    externalIdIdx: uniqueIndex('organizations_external_id_uq').on(t.externalId).where(sql`external_id IS NOT NULL`),
    slugUq: uniqueIndex('organizations_slug_uq').on(t.slug),
  }),
);

export type Organization = typeof organizations.$inferSelect;
export type NewOrganization = typeof organizations.$inferInsert;
