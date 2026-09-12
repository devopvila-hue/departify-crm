-- Migration 0006 — external_grants
--
-- Purpose: durable record that an organization successfully completed an
-- OAuth grant with a provider (Google, Microsoft). This is the SOURCE OF
-- TRUTH for the onboarding cards: when a row exists for a given
-- (organization_id, provider), the corresponding capability card becomes
-- 'ready'. When a user REVOKES access out-of-band, the row is kept but the
-- capability flips to 'needs_permission' on the next refresh; this row
-- itself is never deleted by the application code (only by an explicit
-- admin/CLI rotation we may add later).
--
-- We deliberately do NOT store tokens here. Tokens are the openbot's job;
-- this table records "an OAuth grant happened and what scopes it granted",
-- which is what the onboarding UI needs to render the right card state.
-- This keeps the CRM's security surface narrow: even a full database
-- leak does not give an attacker refresh tokens.
--
-- tenant isolation: organization_id is the join key. No FK to organizations
-- is declared because (a) organizations.id is text in the canonical repo
-- and uuid in the production Supabase, and (b) tenantPlugin already
-- scopes every read to the requester's org. Same pattern as rosa_state
-- and onboarding_prep.

CREATE TABLE IF NOT EXISTS external_grants (
  id              TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  provider        TEXT NOT NULL,
  scopes          JSONB NOT NULL DEFAULT '[]'::jsonb,
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT external_grants_provider_check CHECK (
    provider IN ('google', 'microsoft')
  )
);--> statement-breakpoint

CREATE INDEX IF NOT EXISTS external_grants_org_provider_idx
  ON external_grants (organization_id, provider);