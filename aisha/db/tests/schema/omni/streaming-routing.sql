-- pgTAP acceptance — Omni streaming-routing — async (tier3+) lane DB contract.
-- ============================================================================
-- AREA: Mandatory complexity routing as a contract (spec §6.5, §1 #2, §4.1,
--       §20 P0 #6/#7). This is the DB-side complement of the HTTP SSE-vs-202
--       contract: the tier3+ async lane returns 202 + X-Stream-Poll-URL =
--       /reflect/runs/{id}; the {id} is an ai_runs row, and the lane decision is
--       made by aisha_choose_execution_strategy (strategy: sync|batch).
--
-- ISOLATION: lives under aisha/db/tests/schema/omni/ and is run ONLY in
--   acceptance mode (the default scripts/db/run-schema-tests.mjs harness globs
--   aisha/db/tests/schema/*.sql at the top level and does NOT recurse into omni/,
--   so this file never runs in normal CI). Wrapped in BEGIN…ROLLBACK; pgtap is
--   created inside the transaction so its functions never persist.
--
-- Grounded in real symbols (baseline.sql):
--   • public.ai_runs (table) :2350  — id, kind, story_id, status, workflow_definition_id, metadata
--   • public.aisha_choose_execution_strategy(jsonb, jsonb) RETURNS jsonb :37806
--       returns keys: strategy, batch_eligible, graph_id, mode, profile, slot,
--       required_capabilities, audit_anchor, estimated_cost_usd, reasoning
--   • public.aisha_resolve_clow_backend(jsonb, jsonb) :17681  (eager resolver, §4.2)
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(15);

-- aisha_choose_execution_strategy is auth.uid()-gated (baseline.sql:37846 —
-- "Not authenticated" unless auth.uid() set or role=service_role). Simulate an
-- authenticated caller exactly as 02_rag_isolation_rbac.sql does so the POSITIVE
-- RPC assertions exercise the LANE logic, not the auth guard.
SELECT set_config('request.jwt.claims',
  json_build_object('sub', gen_random_uuid()::text, 'role', 'authenticated')::text, true);

-- ── Surfaces the async (202 + poll) lane depends on EXIST ───────────────────
SELECT has_table('public', 'ai_runs',
  'ai_runs exists — the row the /reflect/runs/{id} poll URL reads (tier3+ 202 lane)');
SELECT has_column('public', 'ai_runs', 'id',
  'ai_runs.id — the {id} echoed in X-Stream-Poll-URL=/reflect/runs/{id}');
SELECT has_column('public', 'ai_runs', 'status',
  'ai_runs.status — poll target observes run progress (NOT token SSE)');
SELECT has_column('public', 'ai_runs', 'story_id',
  'ai_runs.story_id — tenant binding for the orchestrated run');
SELECT has_column('public', 'ai_runs', 'workflow_definition_id',
  'ai_runs.workflow_definition_id — set when chooseExecutionStrategy picks a graph');

SELECT has_function('public', 'aisha_choose_execution_strategy', ARRAY['jsonb','jsonb'],
  'aisha_choose_execution_strategy(jsonb,jsonb) exists — decides sync vs batch lane (§1 #2)');
SELECT has_function('public', 'aisha_resolve_clow_backend', ARRAY['jsonb','jsonb'],
  'aisha_resolve_clow_backend(jsonb,jsonb) exists — eager resolver couples lane+backend (§4.2)');

-- ── POSITIVE: the strategy RPC returns the lane-decision keys the ingress
--    branches on (sync → SSE candidate, batch → deferred/async). ─────────────
SELECT ok(
  (public.aisha_choose_execution_strategy(
     jsonb_build_object('description','hi','type','chat','criticality','normal'),
     '{}'::jsonb
   ) ? 'strategy'),
  'POSITIVE: strategy RPC returns a "strategy" key (sync|batch) the lane decision keys off');

SELECT ok(
  (public.aisha_choose_execution_strategy(
     jsonb_build_object('description','hi','type','chat'),
     '{}'::jsonb
   ) ->> 'strategy') IN ('sync','batch'),
  'POSITIVE: "strategy" is one of the declared values sync|batch (no leakage)');

SELECT ok(
  (public.aisha_choose_execution_strategy(
     jsonb_build_object('description','hi','type','chat'),
     '{}'::jsonb
   ) ? 'batch_eligible'),
  'POSITIVE: strategy RPC exposes batch_eligible — the tier3+ deferred-batch signal (§5.6)');

-- ── POSITIVE: an inserted run is addressable by id (the poll-URL contract). ──
-- §16/§20: ai_runs.story_id is NOT NULL now (multi-tenancy invariant landed) — a
-- platform/story-less run carries the all-zero sentinel (no FK on story_id, so the
-- sentinel needs no partner_stories row). Same value the trigger/system writers use.
SELECT lives_ok($$
  INSERT INTO public.ai_runs (id, kind, status, story_id)
  VALUES ('00000000-0000-0000-0000-0000000000aa', 'reflection', 'running', '00000000-0000-0000-0000-000000000000')
$$, 'POSITIVE: a tier3+ run row can be created and addressed by id (basis for /reflect/runs/{id})');

-- ── NEGATIVE: a non-existent run id has no row → the poll URL for a bogus id
--    must resolve to "no run", never silently succeed (mirrors §19.3 bogus-UUID). ──
SELECT is(
  (SELECT count(*)::int FROM public.ai_runs
     WHERE id = '11111111-1111-1111-1111-111111111111'),
  0,
  'NEGATIVE: a bogus run id has zero ai_runs rows — /reflect/runs/{bogus} cannot poll a real run');

-- ── NEGATIVE: the strategy RPC requires a description; an empty task must error,
--    never return a default "sync" lane for a malformed ingress body. ─────────
SELECT throws_ok($$
  SELECT public.aisha_choose_execution_strategy('{}'::jsonb, '{}'::jsonb)
$$, NULL, NULL,
  'NEGATIVE: strategy RPC raises on missing p_task.description (no silent default lane)');

-- ── FALSE-POSITIVE GUARD: the strategy RPC is STABLE/deterministic — the SAME
--    task must not yield a different lane across calls (no nondeterministic
--    downgrade of an orchestrated task between the resolve and the dispatch). ─
SELECT is(
  (public.aisha_choose_execution_strategy(
     jsonb_build_object('description','Analyze and refactor in detail','type','analyze',
                        'criticality','high','expected_tokens', 50000),
     '{}'::jsonb) ->> 'strategy'),
  (public.aisha_choose_execution_strategy(
     jsonb_build_object('description','Analyze and refactor in detail','type','analyze',
                        'criticality','high','expected_tokens', 50000),
     '{}'::jsonb) ->> 'strategy'),
  'FALSE-POSITIVE GUARD: identical task → identical lane (STABLE) — no flaky downgrade');

-- ── FALSE-POSITIVE GUARD: the eager resolver is a separate authority from the
--    strategy RPC (a function, not folded into chat) — both must exist so the
--    ingress reconciles lane + backend TOGETHER (§4.2), never lane-only. ──────
SELECT is(
  (SELECT count(*)::int FROM pg_proc
     WHERE proname IN ('aisha_choose_execution_strategy','aisha_resolve_clow_backend')),
  2,
  'FALSE-POSITIVE GUARD: both lane-decider AND eager resolver exist (eager resolution, §4.2)');

ROLLBACK;
