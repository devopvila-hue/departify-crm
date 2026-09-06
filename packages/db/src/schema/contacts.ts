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
import { citext, orgId } from './_helpers.js';

export const lifecycleEnum = pgEnum('contact_lifecycle', [
  'lead',
  'prospect',
  'customer',
  'partner',
  'archived',
]);

export const contacts = pgTable(
  'contacts',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    fullName: text('full_name').notNull(),
    email: citext('email'),
    phone: text('phone'),
    jobTitle: text('job_title'),
    /** Optional FK to a company in the same organization. */
    companyId: text('company_id'),
    lifecycle: lifecycleEnum('lifecycle').notNull().default('lead'),
    source: text('source'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    customValues: jsonb('custom_values').$type<Record<string, unknown>>().notNull().default({}),
    /** Public slug for the /c/:slug shareable card. NULL = card disabled. */
    publicSlug: text('public_slug'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('contacts_org_idx').on(t.organizationId),
    orgEmailUq: uniqueIndex('contacts_org_email_uq')
      .on(t.organizationId, t.email)
      .where(sql`email IS NOT NULL`),
    orgLifecycleIdx: index('contacts_org_lifecycle_idx').on(t.organizationId, t.lifecycle),
    orgOwnerIdx: index('contacts_org_owner_idx').on(t.organizationId, t.ownerId),
    orgLastActivityIdx: index('contacts_org_last_activity_idx').on(t.organizationId, t.lastActivityAt),
    orgSearchIdx: index('contacts_org_search_idx').on(t.organizationId, t.fullName),
    publicSlugUq: uniqueIndex('contacts_public_slug_uq').on(t.publicSlug).where(sql`public_slug IS NOT NULL`),
  }),
);

export type Contact = typeof contacts.$inferSelect;
export type NewContact = typeof contacts.$inferInsert;
