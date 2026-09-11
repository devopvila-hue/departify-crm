-- Migration 0004 — Onboarding preparation state (Customer Zero readiness)
-- Purpose: durable, tenant-scoped onboarding state so a new user can walk
-- through the "Departify is preparing your company" experience step by step,
-- cancel at any point, and resume later without re-entering data.
--
-- Design notes:
--   * One row per organization (upsert), created lazily at signup/start.
--   * `phase` is the human-facing stage: preparing → ready | partial | needs_attention.
--   * `prep_cards` holds per-capability state (company|calendar|mail|drive|workspace)
--     with lifecycle states (waiting|preparing|ready|needs_permission|skipped|error).
--   * No provider OAuth credentials are stored here; this table only records
--     the state of preparation, never tokens or secrets.
--   * Tenant isolation is enforced at the application layer via tenantPlugin
--     (same pattern as rosa_state). organization_id is text to match the
--     canonical repo schema; no FK is declared to stay compatible with the
--     production Supabase uuid drift.
--   * `started_at` allows "time since start" to be reported without a fake timer:
--     the client can show elapsed time, never a fabricated percentage.
--   * Idempotent: re-runnable (IF NOT EXISTS) because some environments
--     re-apply checked-in migrations on boot.
DO $$ BEGIN
  CREATE TYPE onboarding_phase AS ENUM (
    'not_started',
    'preparing',
    'ready',
    'partial',
    'needs_attention'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;--> statement-breakpoint

CREATE TABLE IF NOT EXISTS onboarding_prep (
  organization_id       TEXT PRIMARY KEY,
  phase                 onboarding_phase NOT NULL DEFAULT 'not_started',
  prep_cards            JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at            TIMESTAMPTZ,
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS onboarding_prep_phase_idx ON onboarding_prep (phase);