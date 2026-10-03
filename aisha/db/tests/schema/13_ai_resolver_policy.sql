-- pgTAP — ai_resolver_policy (PR1: operator-tunable resolver weights/thresholds substrate)
-- ============================================================================
-- The decision FUNCTION (aisha_resolve_clow_backend) is moving from hardcoded literals to
-- this operator-tunable SoT. This PR ships the table + the always-present GLOBAL default row
-- holding TODAY'S EXACT literals, so wiring the resolver to read it (next PR) is byte-identical
-- — that contract is asserted here (the literal values) + the orchestration-decision matrix
-- (12_*) re-proves it end-to-end once the resolver reads the table.
-- Runs after baseline+heals (the heal seeds the global row); rolled-back txn.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

SELECT has_table('public', 'ai_resolver_policy', '(1) ai_resolver_policy table exists');

-- The GLOBAL default row is always present (seeded by heals + seed; the resolver fails loud
-- on its absence in the follow-up PR).
SELECT is(
  (SELECT count(*)::int FROM ai_resolver_policy WHERE scope_type='global' AND scope_id IS NULL AND task_kind IS NULL),
  1, '(2) exactly one GLOBAL default row exists');

-- The literals match today's hardcoded resolver values (the byte-identical contract).
SELECT is((SELECT bench_weight       FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 0.55::numeric, '(3) bench_weight = 0.55');
SELECT is((SELECT local_bonus        FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 0.20::numeric, '(4) local_bonus = 0.20');
SELECT is((SELECT cost_match_weight  FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 0.15::numeric, '(5) cost_match_weight = 0.15');
SELECT is((SELECT tool_match_weight  FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 0.05::numeric, '(6) tool_match_weight = 0.05');
SELECT is((SELECT premium_max_cost FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 5.00::numeric, '(7) premium_max_cost = 5.00');
SELECT is((SELECT batch_min_tokens   FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), 50000, '(8) batch_min_tokens = 50000');
SELECT is((SELECT health_allow_set   FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL), ARRAY['healthy','unknown'], '(9) health_allow_set = {healthy,unknown}');

-- Constraints fail CLOSED (a bad operator edit is rejected, not coerced).
SELECT throws_ok(
  $$ INSERT INTO ai_resolver_policy (scope_type, scope_id) VALUES ('global', gen_random_uuid()) $$,
  '23514', NULL, '(10) global scope with a non-null scope_id is rejected (scope_id_presence)');
SELECT throws_ok(
  $$ INSERT INTO ai_resolver_policy (scope_type, scope_id, health_allow_set) VALUES ('story', gen_random_uuid(), ARRAY[]::text[]) $$,
  '23514', NULL, '(11) empty health_allow_set is rejected (would exclude every provider)');
SELECT throws_ok(
  $$ INSERT INTO ai_resolver_policy (scope_type, scope_id, budget_max_cost, premium_max_cost) VALUES ('story', gen_random_uuid(), 10.00, 5.00) $$,
  '23514', NULL, '(12) budget cutoff above premium cutoff is rejected (cost_order)');

SELECT * FROM finish();
ROLLBACK;
