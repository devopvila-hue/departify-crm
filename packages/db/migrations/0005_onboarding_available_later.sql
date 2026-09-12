-- Migration 0005 — onboarding_prep: extend prep_card state with `available_later`
--
-- Purpose: Calendar/Mail/Drive integrations are NOT built in this deployment
-- yet. Storing them as `available_later` lets the UI say honestly "you can
-- connect this later" instead of leaving the card stuck in `waiting`
-- forever. Only the backend promotes cards out of this state, and only
-- when a REAL capability ships.
--
-- Idempotent (ADD VALUE IF NOT EXISTS).
--
-- The Drizzle schema (`packages/db/src/schema/onboarding.ts`) widens its
-- TypeScript union to include 'available_later' so the application code
-- agrees. The `pgEnum` enumValues list used at compile time stays the
-- narrower set used in DDL — Postgres only knows about values declared
-- here at CREATE TYPE time; subsequent ADD VALUE migrations widen the
-- runtime set. The TS union widening is the source of truth for the app
-- code, this SQL is the source of truth for the database.

ALTER TYPE onboarding_phase ADD VALUE IF NOT EXISTS 'available_later';
