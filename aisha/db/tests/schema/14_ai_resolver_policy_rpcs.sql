-- pgTAP — ai_resolver_policy audited write/read RPCs (PR3)
-- ============================================================================
-- set_ai_resolver_policy_audited (operator tuning) + list_ai_resolver_policies (editor read):
-- admin/staff-guarded (clone of the spend-policy RPCs), audited, with INHERIT semantics — a NULL
-- param keeps the existing value (never silently zeroes a weight). Proven: both exist, the guard
-- denies non-admins, an admin upsert changes the weight + writes audit_journal, and a partial
-- edit preserves the untouched columns. Runs after baseline+heals (global row seeded); rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

SELECT has_function('public', 'set_ai_resolver_policy_audited',
  ARRAY['text','uuid','text','numeric','numeric','numeric','numeric','numeric','numeric','numeric','numeric','integer','integer','text[]','numeric','integer','integer','numeric','numeric','boolean'],
  '(1) set_ai_resolver_policy_audited exists');
SELECT has_function('public', 'list_ai_resolver_policies', '(2) list_ai_resolver_policies exists');

-- (3)(4) GUARD: with no authenticated admin (auth.uid() NULL), both RPCs raise 42501.
SELECT throws_ok(
  $$ SELECT public.set_ai_resolver_policy_audited(p_bench_weight := 0.99) $$,
  '42501', NULL, '(3) set_ai_resolver_policy_audited denies a non-admin caller');
SELECT throws_ok(
  $$ SELECT public.list_ai_resolver_policies() $$,
  '42501', NULL, '(4) list_ai_resolver_policies denies a non-admin caller');

-- Make an admin actor + authenticate as them (auth.uid() reads request.jwt.claims->>'sub').
SELECT set_config('t.admin', gen_random_uuid()::text, true);
INSERT INTO aisha_auth.users (id) VALUES (current_setting('t.admin')::uuid);
INSERT INTO public.user_roles (user_id, role) VALUES (current_setting('t.admin')::uuid, 'admin');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

-- (5) admin upsert changes a weight (others NULL → inherited).
SELECT lives_ok(
  $$ SELECT public.set_ai_resolver_policy_audited(p_bench_weight := 0.70) $$,
  '(5) an admin may upsert the global policy');
SELECT is(
  (SELECT bench_weight FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL),
  0.70::numeric, '(5b) bench_weight is updated to 0.70');

-- (6) INHERIT: a partial edit (only local_bonus) MUST preserve bench_weight (no silent zero).
SELECT public.set_ai_resolver_policy_audited(p_local_bonus := 0.33);
SELECT is(
  (SELECT (bench_weight, local_bonus) FROM ai_resolver_policy WHERE scope_type='global' AND task_kind IS NULL),
  (0.70::numeric, 0.33::numeric),
  '(6) a partial edit keeps the untouched weight (NULL param inherits, never zeroes)');

-- (7) the write is audited.
SELECT cmp_ok(
  (SELECT count(*)::int FROM audit_journal
     WHERE action = 'ai.resolver_policy.set' AND user_id = current_setting('t.admin')::uuid),
  '>=', 1, '(7) the policy edit writes an audit_journal row');

-- (8) the editor read returns the global row to an admin.
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.list_ai_resolver_policies() WHERE scope_type = 'global'),
  '>=', 1, '(8) list_ai_resolver_policies returns the global row to an admin');

SELECT * FROM finish();
ROLLBACK;
