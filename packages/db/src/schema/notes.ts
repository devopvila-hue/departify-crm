import { pgTable, text, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { users } from './users.js';
import { orgId } from './_helpers.js';

export const noteSubjectEnum = pgEnum('note_subject', ['contact', 'company', 'deal']);

export const notes = pgTable(
  'notes',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    subjectType: noteSubjectEnum('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    /** Nullable: system-generated notes (e.g. activity logs) have no human author. */
    authorId: text('author_id').references(() => users.id, { onDelete: 'set null' }),
    /** Markdown body. Rendered with a safe renderer client-side. */
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    subjectIdx: index('notes_subject_idx').on(t.subjectType, t.subjectId),
    orgIdx: index('notes_org_idx').on(t.organizationId),
  }),
);

export type Note = typeof notes.$inferSelect;
