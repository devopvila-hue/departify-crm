-- Migration 0007 — external_grants.provider_email
--
-- Purpose: store the Google account email that completed the OAuth grant.
-- This lets the CRM display "Connected as alice@company.com" in the
-- onboarding UI and audit trails without ever touching tokens.
--
-- Idempotent: re-runnable (ALTER TABLE IF NOT EXISTS pattern not available
-- in raw PG; we use a DO block to guard against double-application).
DO $$ BEGIN
  ALTER TABLE external_grants ADD COLUMN provider_email TEXT;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;

-- Index for lookups by email (audit, display).
CREATE INDEX IF NOT EXISTS external_grants_provider_email_idx
  ON external_grants (provider_email)
  WHERE provider_email IS NOT NULL;
