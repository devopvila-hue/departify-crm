import { pgTable, text, timestamp, jsonb, index, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { orgId } from './_helpers.js';

export const activityTypeEnum = pgEnum('activity_type', [
  'note',
  'email',
  'call',
  'meeting',
  'task',
  'status_change',
  'deal_change',
  'sequence_event',
  'system_event',
]);

export const activitySubjectEnum = pgEnum('activity_subject', ['contact', 'company', 'deal', 'organization']);

export const activities = pgTable(
  'activities',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    type: activityTypeEnum('type').notNull(),
    subjectType: activitySubjectEnum('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    actorId: text('actor_id').references(() => users.id, { onDelete: 'set null' }),
    title: text('title').notNull(),
    body: text('body'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('activities_subject_idx').on(t.subjectType, t.subjectId, t.createdAt),
    orgIdx: index('activities_org_idx').on(t.organizationId, t.createdAt),
  }),
);

export type Activity = typeof activities.$inferSelect;
