-- ============================================================================
-- Table: aitg_test_catalog
-- Purpose: Canonical catalog of OWASP AI Testing Guide (AITG) v1 — 44 tests
--          across 4 layers (APP/MOD/INF/DAT). Seed data — append-only via
--          migration; never write at runtime.
-- ============================================================================

-- PostgreSQL does NOT support `CREATE TYPE IF NOT EXISTS`. Use idempotent
-- DO $$ EXCEPTION WHEN duplicate_object pattern — matches the same shape
-- used by the migration 20260516144654_aitg_baseline.sql that introduced
-- these types, so baseline regeneration produces valid SQL.
DO $$ BEGIN
  CREATE TYPE aitg_layer AS ENUM ('app', 'mod', 'inf', 'dat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aitg_severity AS ENUM ('info', 'low', 'medium', 'high', 'critical');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE aitg_status AS ENUM ('passed', 'failed', 'flaky', 'blocked', 'waived', 'not_applicable');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.aitg_test_catalog (
  test_id          text PRIMARY KEY CHECK (test_id ~ '^AITG-(APP|MOD|INF|DAT)-\d{2}$'),
  layer            aitg_layer NOT NULL,
  title            text NOT NULL,
  objective        text NOT NULL,
  remediation_ref  text NOT NULL,
  lifecycle_phases text[] NOT NULL DEFAULT '{}'::text[],
  severity_weight  numeric NOT NULL DEFAULT 1.0 CHECK (severity_weight >= 0),
  enabled          boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.aitg_test_catalog ENABLE ROW LEVEL SECURITY;
