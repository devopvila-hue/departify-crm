-- Migration 0003 — ROSA v0.1 state table
-- Purpose: durable work-state for cross-session/cross-worker continuity.
-- This table stores REFERENCES only (≤50KB payload, no blobs, no transcripts).
--
-- Tenant isolation is enforced at the application layer via the existing
-- `tenantPlugin` middleware (see apps/api/src/tenants/plugin.ts) and via
-- the RosaService, which scopes every query by ctx.organizationId.
-- No FK is declared on organization_id because:
--   1. The canonical repo declares organizations.id as text.
--   2. Production Supabase has organizations.id as uuid (schema drift).
--   3. A text FK against uuid would fail; a uuid FK against text would
--      fail; making rosa_state.organization_id match either would break
--      the other environment.
-- The unique index on (organization_id, work_id) provides data-level
-- uniqueness; the RosaService provides app-layer tenant isolation.
-- This is consistent with the original comment and the ROSA v0.1 contract
-- (no new RLS, app-layer filtering).

CREATE TYPE rosa_status AS ENUM (
  'planned',
  'in_progress',
  'blocked',
  'awaiting_review',
  'complete',
  'abandoned'
);--> statement-breakpoint

CREATE TABLE rosa_state (
  rosa_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rosa_version    TEXT NOT NULL DEFAULT '0.1',
  organization_id TEXT NOT NULL,
  work_id         UUID NOT NULL,
  objective       TEXT NOT NULL,
  state           rosa_status NOT NULL DEFAULT 'planned',
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision        INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rosa_state_objective_len    CHECK (length(objective) <= 500),
  CONSTRAINT rosa_state_rosa_version_len CHECK (length(rosa_version) <= 10),
  CONSTRAINT rosa_state_revision_positive CHECK (revision >= 1)
);--> statement-breakpoint

CREATE UNIQUE INDEX rosa_state_org_work_uq ON rosa_state (organization_id, work_id);--> statement-breakpoint
CREATE INDEX rosa_state_org_state_idx ON rosa_state (organization_id, state, updated_at DESC);--> statement-breakpoint
