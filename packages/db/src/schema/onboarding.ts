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

/**
 * Per-capability preparation state.
 *
 * Honest semantics:
 *  - 'waiting'      → real work not yet started
 *  - 'preparing'    → real work in flight (UI may display a spinner; backend owns the move)
 *  - 'ready'        → REAL work completed by the system; user has not opted into this state
 *  - 'needs_permission' → REAL work requires an OAuth grant the user hasn't given yet
 *  - 'available_later' → REAL work does not exist in this deployment yet (capability not built)
 *  - 'skipped'      → user (or product rule) explicitly chose not to do this now
 *  - 'error'        → REAL work failed; will be retried out of band
 *
 * The UI never transitions any of these. Only backend operations do.
 */
export type PrepCardState =
  | 'waiting'
  | 'preparing'
  | 'ready'
  | 'needs_permission'
  | 'available_later'
  | 'skipped'
  | 'error';

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