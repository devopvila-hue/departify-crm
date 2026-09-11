/**
 * DEPARTIFY CRM — ROSA state schema
 *
 * Work State for cross-session/cross-worker continuity. NOT a duplicate
 * of existing state machines (sequence_enrollments, tasks, deals).
 * Use case: multi-step AI analyses where partial progress must survive
 * worker restart/scale-down without re-paying expensive upstream costs.
 *
 * Contract: ROSA v0.1 (see /opt/opencloud-knowledge/refs/decisions-index.md
 * and ADR to be filed after this implementation lands).
 */
import { pgTable, text, jsonb, timestamp, integer, uuid, index, check, pgEnum } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { orgId } from './_helpers.js';

export const rosaStateEnum = pgEnum('rosa_status', [
  'planned',
  'in_progress',
  'blocked',
  'awaiting_review',
  'complete',
  'abandoned',
]);

/**
 * rosaState — one ROSA row per (org_id, work_id).
 * `revision` provides optimistic concurrency; `payload` is the full
 * v0.1 contract (decisions, invariants, refs, completed, pending,
 * next_action, blockers, results, verification).
 */
export const rosaState = pgTable(
  'rosa_state',
  {
    rosaId: uuid('rosa_id').primaryKey().defaultRandom(),
    rosaVersion: text('rosa_version').notNull().default('0.1'),
    orgId: orgId(),
    workId: uuid('work_id').notNull(),
    objective: text('objective').notNull(),
    state: rosaStateEnum('state').notNull().default('planned'),
    payload: jsonb('payload').$type<RosaPayload>().notNull().default({} as RosaPayload),
    revision: integer('revision').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orgWorkUq: index('rosa_state_org_work_uq').on(t.orgId, t.workId),
    orgStateIdx: index('rosa_state_org_state_idx').on(t.orgId, t.state, t.updatedAt),
    objectiveLen: check('rosa_state_objective_len', sql`length(${t.objective}) <= 500`),
    rosaVersionLen: check('rosa_state_rosa_version_len', sql`length(${t.rosaVersion}) <= 10`),
  }),
);

export type RosaRow = typeof rosaState.$inferSelect;
export type RosaNewRow = typeof rosaState.$inferInsert;

/**
 * ROSA v0.1 payload — kept narrow; references only, no blobs.
 * All summaries are short strings; large content belongs in
 * evidence_refs (URI/path) or the resource tables.
 */
export interface RosaPayload {
  decisions?: Array<{ id: string; decision: string; rationale: string }>;
  invariants?: string[];
  context_refs?: string[];
  evidence_refs?: string[];
  completed?: Array<{ id: string; summary: string }>;
  pending?: Array<{ id: string; summary: string }>;
  next_action?: { who: string; what: string };
  blockers?: Array<{ id: string; description: string }>;
  results?: Array<{ id: string; summary: string }>;
  verification?: { criteria: string[]; status: 'pending' | 'partial' | 'passed' | 'failed' };
}
