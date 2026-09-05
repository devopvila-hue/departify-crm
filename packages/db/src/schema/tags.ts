import { pgTable, text, timestamp, index, uniqueIndex, pgEnum, primaryKey } from 'drizzle-orm/pg-core';
import { orgId } from './_helpers.js';
import { contacts } from './contacts.js';
import { companies } from './companies.js';
import { deals } from './deals.js';

export const tagEntityEnum = pgEnum('tag_entity', ['contact', 'company', 'deal']);

export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    color: text('color'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgNameUq: uniqueIndex('tags_org_name_uq').on(t.organizationId, t.name),
  }),
);

export const contactTags = pgTable(
  'contact_tags',
  {
    organizationId: orgId(),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull().references(() => contacts.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.contactId] }),
    contactIdx: index('contact_tags_contact_idx').on(t.contactId),
  }),
);

export const companyTags = pgTable(
  'company_tags',
  {
    organizationId: orgId(),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.companyId] }),
    companyIdx: index('company_tags_company_idx').on(t.companyId),
  }),
);

export const dealTags = pgTable(
  'deal_tags',
  {
    organizationId: orgId(),
    tagId: text('tag_id').notNull().references(() => tags.id, { onDelete: 'cascade' }),
    dealId: text('deal_id').notNull().references(() => deals.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.tagId, t.dealId] }),
    dealIdx: index('deal_tags_deal_idx').on(t.dealId),
  }),
);

export type Tag = typeof tags.$inferSelect;
