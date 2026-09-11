-- Migration 0003 — ROSA v0.1 state table
-- Purpose: durable work-state for cross-session/cross-worker continuity.
-- This table stores REFERENCES only (≤50KB payload, no blobs, no transcripts).
-- Tenant isolation is enforced at the application layer via the existing
-- `tenantPlugin` middleware (see apps/api/src/tenants/plugin.ts). No new
-- RLS is introduced — the rest of the CRM relies on app-layer filtering.

-- ENUM is named rosa_status (not rosa_state) because PostgreSQL does
-- not allow a table and a type to share a name in the same schema.
CREATE TYPE rosa_status AS ENUM (
  'planned',
  'in_progress',
  'blocked',
  'awaiting_review',
  'complete',
  'abandoned'
);

CREATE TABLE rosa_state (
  rosa_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rosa_version TEXT NOT NULL DEFAULT '0.1',
  organization_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  work_id      UUID NOT NULL,
  objective    TEXT NOT NULL,
  state        rosa_status NOT NULL DEFAULT 'planned',
  payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
  revision     INTEGER NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT rosa_state_objective_len CHECK (length(objective) <= 500),
  CONSTRAINT rosa_state_rosa_version_len CHECK (length(rosa_version) <= 10),
  CONSTRAINT rosa_state_revision_positive CHECK (revision >= 1)
);

CREATE UNIQUE INDEX rosa_state_org_work_uq ON rosa_state (organization_id, work_id);
CREATE INDEX rosa_state_org_state_idx ON rosa_state (organization_id, state, updated_at DESC);
