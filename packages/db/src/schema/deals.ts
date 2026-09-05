import {
  pgTable,
  text,
  integer,
  bigint,
  timestamp,
  index,
  uniqueIndex,
  pgEnum,
  jsonb,
} from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { orgId } from './_helpers.js';
import { pipelines, stages } from './pipelines.js';

export const dealStatusEnum = pgEnum('deal_status', ['open', 'won', 'lost']);

export const deals = pgTable(
  'deals',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'restrict' }),
    stageId: text('stage_id')
      .notNull()
      .references(() => stages.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    companyId: text('company_id'),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    /** Value in minor units (cents) to avoid floating-point arithmetic. */
    valueMinor: bigint('value_minor', { mode: 'number' }).notNull().default(0),
    currency: text('currency').notNull().default('EUR'),
    probability: integer('probability').notNull().default(0),
    expectedCloseAt: timestamp('expected_close_at', { withTimezone: true }),
    status: dealStatusEnum('status').notNull().default('open'),
    source: text('source'),
    customValues: jsonb('custom_values').$type<Record<string, unknown>>().notNull().default({}),
    wonAt: timestamp('won_at', { withTimezone: true }),
    lostAt: timestamp('lost_at', { withTimezone: true }),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgIdx: index('deals_org_idx').on(t.organizationId),
    orgPipelineIdx: index('deals_org_pipeline_idx').on(t.organizationId, t.pipelineId),
    orgStageIdx: index('deals_org_stage_idx').on(t.organizationId, t.stageId),
    orgStatusIdx: index('deals_org_status_idx').on(t.organizationId, t.status),
  }),
);

export const dealContacts = pgTable(
  'deal_contacts',
  {
    organizationId: orgId(),
    dealId: text('deal_id')
      .notNull()
      .references(() => deals.id, { onDelete: 'cascade' }),
    contactId: text('contact_id').notNull(),
    role: text('role'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: uniqueIndex('deal_contacts_pk').on(t.dealId, t.contactId),
    contactIdx: index('deal_contacts_contact_idx').on(t.contactId),
  }),
);

export type Deal = typeof deals.$inferSelect;
export type NewDeal = typeof deals.$inferInsert;
