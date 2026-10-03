-- pgTAP — Orchestration-Decision matrix (PH1: the harness's core proof, runtime)
-- ============================================================================
-- aisha_resolve_clow_backend dynamically picks model+executor from ALL serviceable
-- candidates — nothing hardcoded. This drives the resolver across the decision axes with
-- a KNOWN synthetic provider/model set and asserts the WINNER + that the choice is dynamic
-- (same task × different serviceable_slugs → different winner). The eval/bench axis stays
-- at the default 0.5 (bench-driven rank is a Fáze-2 dep, per the master plan); here we prove
-- task_kind/capability, cost, residency, serviceable, local, and tools.
-- Runs UNSEEDED as service_role in a rolled-back txn; deletes any pre-existing registry rows
-- first so the synthetic set is the only candidate population (deterministic).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(10);

-- Isolate the candidate population (rolled back).
DELETE FROM public.ai_model_benchmarks;
DELETE FROM public.ai_model_registry;
DELETE FROM public.ai_provider_registry;

-- Three providers: a budget cloud, a premium cloud, and a local backend (all healthy/enabled).
INSERT INTO public.ai_provider_registry (slug, display_name, backend_kind, cost_class, is_enabled, last_health_status, supports_batch) VALUES
  ('pm-cloud-budget',  'Budget Cloud',  'direct_cloud', 'budget',  true, 'healthy', false),
  ('pm-cloud-premium', 'Premium Cloud', 'direct_cloud', 'premium', true, 'healthy', false),
  ('pm-local',         'Local',         'local_ollama', 'budget',  true, 'healthy', false);

-- Models (provider=slug uses the resolver's r.provider=p.slug fallback join). Capability flags
-- default chat-capable / non-embedding; override per model.
INSERT INTO public.ai_model_registry (provider, model_id, is_chat_capable, is_embedding, is_function_calling, is_vision) VALUES
  ('pm-cloud-budget',  'm-budget-chat',  true,  false, false, false),
  ('pm-cloud-premium', 'm-premium-chat', true,  false, false, false),
  ('pm-cloud-premium', 'm-tools',        true,  false, true,  false),
  ('pm-local',         'm-local-chat',   true,  false, false, false),
  ('pm-cloud-budget',  'm-embed',        false, true,  false, false);

SET LOCAL ROLE service_role;

-- helper clow: a plain chat task.
-- (1) serviceable=[budget] → the budget provider wins (it is the only serviceable candidate).
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-budget"]}'::jsonb)->'top'->>'provider_slug'),
  'pm-cloud-budget', '(1) serviceable=[budget] resolves to the budget provider');

-- (2) SAME task, serviceable=[premium] → premium wins. Different serviceable ⇒ different winner
--     = the dynamism proof (no hardcoded matrix).
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-premium"]}'::jsonb)->'top'->>'provider_slug'),
  'pm-cloud-premium', '(2) same task, serviceable=[premium] → DIFFERENT winner (dynamic)');

-- (3) residency: cloud_forbidden=true → only on-prem eligible → local wins, cloud excluded.
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat","cloud_forbidden":true}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-budget","pm-cloud-premium","pm-local"]}'::jsonb)->'top'->>'provider_slug'),
  'pm-local', '(3) cloud_forbidden=true → only local is eligible (cloud reaches zero)');

-- (4) allow_local=false hard-excludes local; with only local serviceable → no backend (fail loud).
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat","allow_local":false}'::jsonb,
     '{"serviceable_slugs":["pm-local"]}'::jsonb)->>'resolved'),
  'false', '(4) allow_local=false + only local serviceable → resolved=false (no substitution)');

-- (5) task_kind=embedding → the embedding-capability gate picks the embedding model, not a chat one.
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"embedding"}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-budget"]}'::jsonb)->'top'->>'model_id'),
  'm-embed', '(5) task_kind=embedding resolves to the embedding model (capability gate)');

-- (6) cost: max_cost>5 ⇒ cost_class=premium ⇒ the premium provider gets the cost_match boost.
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat","max_cost":10}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-budget","pm-cloud-premium"]}'::jsonb)->'top'->>'provider_slug'),
  'pm-cloud-premium', '(6) max_cost>$5 → premium cost-class match wins');

-- (7) needs_tools → only function-calling models survive → the tools model wins.
SELECT is(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat","needs_tools":true}'::jsonb,
     '{"serviceable_slugs":["pm-cloud-budget","pm-cloud-premium"]}'::jsonb)->'top'->>'model_id'),
  'm-tools', '(7) needs_tools → only the function-calling model is eligible');

-- (8) transparency: a resolved decision always carries reasoning + a scored candidate list.
SELECT ok(
  (SELECT (res->>'resolved')::boolean AND res ? 'reasoning' AND jsonb_array_length(res->'candidates') >= 1
   FROM aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb,
          '{"serviceable_slugs":["pm-cloud-budget"]}'::jsonb) AS res),
  '(8) a resolved decision is transparent (reasoning + scored candidates)');

-- The above 8 also re-prove the PR2 BYTE-IDENTICAL contract: the resolver now reads
-- ai_resolver_policy (global row), and because that row holds the exact former literals, every
-- decision is unchanged. The next two prove the policy is actually READ (operator-tunable) +
-- fail-loud — the operator-control half of the design.

-- (9) operator-tunable: raising local_bonus in the policy raises the local candidate's score.
SELECT set_config('t.score_before',
  (aisha_resolve_knob.res->'top'->>'score')
  , true)
FROM (SELECT aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb,
        '{"serviceable_slugs":["pm-local"]}'::jsonb) AS res) aisha_resolve_knob;
UPDATE public.ai_resolver_policy SET local_bonus = 0.40 WHERE scope_type = 'global' AND task_kind IS NULL;
SELECT cmp_ok(
  (aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb,
     '{"serviceable_slugs":["pm-local"]}'::jsonb)->'top'->>'score')::numeric,
  '>', current_setting('t.score_before')::numeric,
  '(9) raising local_bonus in ai_resolver_policy raises the local score (policy is read + tunable)');

-- (10) fail-loud: with no active global policy row, the resolver RAISES (no silent literal fallback).
DELETE FROM public.ai_resolver_policy WHERE scope_type = 'global';
SELECT throws_ok(
  $$ SELECT aisha_resolve_clow_backend('{"purpose":"p","task_kind":"chat"}'::jsonb, '{"serviceable_slugs":["pm-local"]}'::jsonb) $$,
  'P0001', NULL, '(10) missing global ai_resolver_policy row → resolver raises (fail-loud, no fallback)');

SELECT * FROM finish();
ROLLBACK;
