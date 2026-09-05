import { pgTable, text, integer, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { orgId } from './_helpers.js';

export const pipelines = pgTable(
  'pipelines',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    name: text('name').notNull(),
    /** Optional purpose tag — e.g. "sales", "recruiting". Free-form for now. */
    purpose: text('purpose'),
    /** Position used for ordering inside the org. */
    position: integer('position').notNull().default(0),
    isArchived: integer('is_archived').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgUq: uniqueIndex('pipelines_org_name_uq').on(t.organizationId, t.name),
    orgIdx: index('pipelines_org_idx').on(t.organizationId),
  }),
);

export const stages = pgTable(
  'stages',
  {
    id: text('id').primaryKey(),
    organizationId: orgId(),
    pipelineId: text('pipeline_id')
      .notNull()
      .references(() => pipelines.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    position: integer('position').notNull().default(0),
    /** Probability (0-100) used as a sensible default for deals entering the stage. */
    defaultProbability: integer('default_probability').notNull().default(0),
    /** Used by Kanban accent + analytics. */
    color: text('color'),
    isWon: integer('is_won').notNull().default(0),
    isLost: integer('is_lost').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pipeIdx: index('stages_pipeline_idx').on(t.pipelineId, t.position),
    pipeNameUq: uniqueIndex('stages_pipeline_name_uq').on(t.pipelineId, t.name),
  }),
);

export type Pipeline = typeof pipelines.$inferSelect;
export type Stage = typeof stages.$inferSelect;
