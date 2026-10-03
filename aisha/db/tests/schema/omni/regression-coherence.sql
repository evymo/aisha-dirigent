-- pgTAP acceptance — area: regression-coherence (§4.1, §19, §19.1, §20)
-- ============================================================================
-- Source of truth: docs/planning/AISHA_OMNI_GATEWAY.md (v4).
--
-- ISOLATION: this file lives under aisha/db/tests/schema/omni/ which the default
-- pgTAP runner (scripts/db/run-schema-tests.mjs) does NOT pick up — it reads the
-- TOP-LEVEL aisha/db/tests/schema/*.sql flat (readdirSync, non-recursive). So
-- this acceptance file never runs in the cold-start gate; it executes ONLY in
-- Omni acceptance mode (a runner pointed at this subdir). Wrapped BEGIN…ROLLBACK
-- + CREATE EXTENSION pgtap → never persists. (Mirrors the sibling
-- story-resolver-hole.sql / streaming-routing.sql isolation contract.)
--
-- AREA CONTRACT — the backend is ONE story-scoped engine behind many surfaces.
-- The single coherence anchor is: every governed JWT ingress reaches
-- orchestrationBridge.routeViaAisha → the SECURITY DEFINER function
-- public.route_task(...) → INSERT INTO ai_runs(kind, story_id, …)
-- (aisha/db/sql/functions/route_task.sql:217). This file pins that anchor IN-DB,
-- plus the §19.1 invariant and the §19.1 "/public-chat: bez story by design"
-- isolation, asserted structurally against the live schema.
--
--   POSITIVE         — route_task(p_task_kind,…,p_story_id) returns a run_id AND
--                      writes an ai_runs row whose story_id == the passed story
--                      (engine-coherence anchor: ingress → route_task → ai_runs).
--   POSITIVE (struct)— route_task is SECURITY DEFINER with the documented arg
--                      list (the one shared writer — no per-surface fork).
--   FALSE-POSITIVE   — /public-chat is NOT governed: get_active_channel_config
--                      (the public-chat config source, public-chat.ts:48) takes
--                      a channel slug and exposes NO story_id arg/return — the
--                      public surface never reaches story binding.
--   INVARIANT (RED)  — §19.1 / §20 P0 #5: ai_runs.story_id MUST become NOT NULL
--                      (carries RLS/chargeback/governance/audit). Today the
--                      column is NULLABLE (aisha/db/sql/tables/ai_runs.sql:7) →
--                      this assertion FAILS now (regression guard) and flips
--                      GREEN once the column is hardened. Complements the same
--                      invariant in story-resolver-hole.sql (kept here so the
--                      coherence suite is self-contained for this area).
--
-- Identities are parametric session GUCs (gen_random_uuid), mirroring
-- aisha/db/tests/schema/02_rag_isolation_rbac.sql. Runs as superuser against the
-- APPLIED (unseeded) schema; route_task is SECURITY DEFINER.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(6);

-- ── Parametric identities ────────────────────────────────────────────────────
SELECT set_config('rc.tenant_a', gen_random_uuid()::text, true);
SELECT set_config('rc.story_a',  gen_random_uuid()::text, true);

-- ── Fixtures: tenant A owns an ACTIVE story (FK-safe principals). ─────────────
INSERT INTO aisha_auth.users (id) VALUES (current_setting('rc.tenant_a')::uuid)
  ON CONFLICT DO NOTHING;
INSERT INTO partner_stories (id, user_id, title, status)
  VALUES (current_setting('rc.story_a')::uuid, current_setting('rc.tenant_a')::uuid,
          'omni-acceptance regression-coherence tenant-A story', 'active');

-- ════════════════════════════════════════════════════════════════════════════
-- STRUCTURAL — route_task is the single ingress→ai_runs writer: SECURITY DEFINER
-- with the documented arg list (route_task.sql:8-15). One brain, no fork.
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'route_task'
      AND p.prosecdef                     -- SECURITY DEFINER
      AND p.pronargs = 6                  -- (kind, risk, domain[], tech[], story_id, constraints)
  ),
  'structural: public.route_task(...) exists as the SECURITY DEFINER ingress→ai_runs writer'
);

-- ════════════════════════════════════════════════════════════════════════════
-- POSITIVE — engine coherence: route_task returns a run_id AND the row it created
-- in ai_runs carries the story_id that was passed (ingress → route_task → ai_runs).
-- ════════════════════════════════════════════════════════════════════════════
SELECT set_config(
  'rc.run_id',
  (
    SELECT (public.route_task(
      'chat',                                   -- p_task_kind
      'low',                                    -- p_risk_profile
      '{}'::text[],                             -- p_domain
      ARRAY['postgrest','typescript']::text[],  -- p_tech
      current_setting('rc.story_a')::uuid,      -- p_story_id
      '{}'::jsonb                               -- p_constraints
    ) ->> 'run_id')
  ),
  true
);

SELECT isnt(
  current_setting('rc.run_id'),
  NULL,
  'POSITIVE: route_task returns a non-null run_id (a run was registered)'
);

SELECT is(
  (SELECT kind FROM ai_runs WHERE id = current_setting('rc.run_id')::uuid),
  'chat',
  'POSITIVE: the ai_runs row records the ingress kind (chat) — coherence anchor'
);

SELECT is(
  (SELECT story_id FROM ai_runs WHERE id = current_setting('rc.run_id')::uuid),
  current_setting('rc.story_a')::uuid,
  'POSITIVE: ai_runs.story_id == the story_id route_task was called with (ingress→ai_runs story binding)'
);

-- ════════════════════════════════════════════════════════════════════════════
-- FALSE-POSITIVE — /public-chat stays OUT of governance (§19.1 "bez story by
-- design"). Its config source is get_active_channel_config (public-chat.ts:48),
-- keyed by a channel slug — it must expose NO story_id parameter (the public
-- surface never reaches story binding). Asserted on the function arg-name list.
-- ════════════════════════════════════════════════════════════════════════════
SELECT ok(
  NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    LEFT JOIN LATERAL unnest(COALESCE(p.proargnames, '{}')) AS a(name) ON TRUE
    WHERE n.nspname = 'public'
      AND p.proname = 'get_active_channel_config'
      AND a.name ILIKE '%story%'
  ),
  'FALSE-POSITIVE: get_active_channel_config (public-chat config) has NO story arg — public surface is ungoverned'
);

-- ════════════════════════════════════════════════════════════════════════════
-- INVARIANT (expected-RED) — §19.1 / §20 P0 #5: ai_runs.story_id MUST become
-- NOT NULL. Today the column is NULLABLE → this assertion FAILS now and pins the
-- invariant as a regression guard; it flips GREEN once the column is hardened.
-- ════════════════════════════════════════════════════════════════════════════
SELECT is(
  (SELECT attnotnull FROM pg_attribute
    WHERE attrelid = 'public.ai_runs'::regclass AND attname = 'story_id'),
  TRUE,
  'INVARIANT (RED today): ai_runs.story_id is NOT NULL (RLS/chargeback/governance/audit) — §19.1/§20 P0 #5'
);

SELECT * FROM finish();
ROLLBACK;
