/**
 * DEPARTIFY CRM — onboarding preparation schema
 *
 * Durable, tenant-scoped onboarding state for the "Departify prepares your
 * company" flow. One row per organization; upsert-only. Stores capability
 * states (NOT tokens, NOT provider credentials — those never live here).
 *
 * Lifecycle: not_started → preparing → ready | partial | needs_attention.
 * The UI maps these to product copy; no fake progress is derived from this
 * table (percentages are never stored, only semantic state).
 */
import { pgTable, text, jsonb, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';

export const onboardingPhaseEnum = pgEnum('onboarding_phase', [
  'not_started',
  'preparing',
  'ready',
  'partial',
  'needs_attention',
]);

export type OnboardingPhase = (typeof onboardingPhaseEnum.enumValues)[number];

/** Per-capability preparation state, e.g. { company: 'ready', calendar: 'needs_permission' } */
export type PrepCardState = 'waiting' | 'preparing' | 'ready' | 'needs_permission' | 'skipped' | 'error';

export const onboardingPrep = pgTable(
  'onboarding_prep',
  {
    organizationId: text('organization_id').primaryKey(),
    phase: onboardingPhaseEnum('phase').notNull().default('not_started'),
    prepCards: jsonb('prep_cards').$type<Record<string, PrepCardState>>().notNull().default({}),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    phaseIdx: index('onboarding_prep_phase_idx').on(t.phase),
  }),
);

export type OnboardingRow = typeof onboardingPrep.$inferSelect;
export type NewOnboardingRow = typeof onboardingPrep.$inferInsert;