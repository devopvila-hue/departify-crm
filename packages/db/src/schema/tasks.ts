import { pgTable, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { orgId } from './_helpers.js';

export const taskStatusEnum = pgEnum('task_status', ['open', 'done', 'cancelled']);
export const taskPriorityEnum = pgEnum('task_priority', ['low', 'normal', 'high', 'urgent']);
export const taskSubjectEnum = pgEnum('task_subject', ['contact', 'company', 'deal', 'general']);

export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    title: text('title').notNull(),
    description: text('description'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    ownerId: text('owner_id').references(() => users.id, { onDelete: 'set null' }),
    subjectType: taskSubjectEnum('subject_type').notNull().default('general'),
    subjectId: text('subject_id'),
    status: taskStatusEnum('status').notNull().default('open'),
    priority: taskPriorityEnum('priority').notNull().default('normal'),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgStatusIdx: index('tasks_org_status_idx').on(t.organizationId, t.status),
    orgDueIdx: index('tasks_org_due_idx').on(t.organizationId, t.dueAt),
    orgOwnerIdx: index('tasks_org_owner_idx').on(t.organizationId, t.ownerId),
  }),
);

export type Task = typeof tasks.$inferSelect;
