-- pgTAP — eval-before-migration gate (G4, odysseus impl/14 + impl/13 §5.2)
-- ============================================================================
-- set_active_ai_model_admin must refuse to ACTIVATE a model without a green
-- eval: eval_status IN ('tested','approved') AND a current ai_model_benchmarks
-- row with overall_score >= ai_runtime.eval_min_overall_score (fallback 0.6).
-- Fail-closed: NO benchmark result = FAIL (never a silent pass). Deactivation
-- is not gated. Proven here end-to-end against the assembled baseline:
-- guard denies non-admins, unevaled model blocked, sub-threshold blocked,
-- green model activates + audit row written, deactivation always allowed.
-- Runs after baseline+heals; rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

SELECT has_function('public', 'set_active_ai_model_admin', ARRAY['text','text','boolean'],
  '(1) set_active_ai_model_admin exists');

-- (2) GUARD: with no authenticated admin (auth.uid() NULL) the RPC raises 42501.
SELECT throws_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', true) $$,
  '42501', NULL, '(2) set_active_ai_model_admin denies a non-admin caller');

-- Make an admin actor + authenticate as them (auth.uid() reads request.jwt.claims->>'sub').
SELECT set_config('t.admin', gen_random_uuid()::text, true);
INSERT INTO aisha_auth.users (id) VALUES (current_setting('t.admin')::uuid);
INSERT INTO public.user_roles (user_id, role) VALUES (current_setting('t.admin')::uuid, 'admin');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role', 'authenticated')::text, true);

-- Fixture model: fresh from discovery (eval_status='pending', NO benchmark row).
INSERT INTO public.ai_model_registry (provider, model_id, eval_status)
VALUES ('pgtap-prov', 'pgtap-model', 'pending');

-- (3) FAIL-CLOSED: no eval result at all → activation blocked (23514).
SELECT throws_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', true) $$,
  '23514', NULL, '(3) a model with NO eval result cannot be activated (fail-closed)');

-- (4) eval_status green but benchmark BELOW threshold → still blocked.
UPDATE public.ai_model_registry SET eval_status = 'tested'
WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model';
INSERT INTO public.ai_model_benchmarks (model_registry_id, task_type, overall_score, sample_count)
SELECT id, 'chat', 0.2, 3 FROM public.ai_model_registry
WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model';
SELECT throws_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', true) $$,
  '23514', NULL, '(4) a sub-threshold benchmark blocks activation');

-- (5) benchmark >= threshold but eval_status regressed → blocked (both must hold).
UPDATE public.ai_model_benchmarks SET overall_score = 0.95
WHERE model_registry_id = (SELECT id FROM public.ai_model_registry
                           WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model');
UPDATE public.ai_model_registry SET eval_status = 'pending'
WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model';
SELECT throws_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', true) $$,
  '23514', NULL, '(5) a green benchmark alone is not enough — eval_status must be tested/approved');

-- (6) GREEN PATH: tested + benchmark above threshold → activation succeeds.
UPDATE public.ai_model_registry SET eval_status = 'tested'
WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model';
SELECT lives_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', true) $$,
  '(6) a model with a green eval activates');
SELECT is(
  (SELECT is_admin_active FROM public.ai_model_registry
   WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model'),
  true, '(6b) the model is admin-active after the green activation');

-- (7) the activation is audited with the eval evidence.
SELECT cmp_ok(
  (SELECT count(*)::int FROM public.audit_journal
     WHERE action = 'ai_model_admin_override'
       AND user_id = current_setting('t.admin')::uuid
       AND metadata->>'eval_status' = 'tested'),
  '>=', 1, '(7) the override audit row carries the eval evidence');

-- (8) deactivation is NOT gated — an unevaled model may always be switched off.
UPDATE public.ai_model_registry SET eval_status = 'pending'
WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-model';
SELECT lives_ok(
  $$ SELECT public.set_active_ai_model_admin('pgtap-prov', 'pgtap-model', false) $$,
  '(8) deactivation is allowed regardless of eval state');

SELECT * FROM finish();
ROLLBACK;
