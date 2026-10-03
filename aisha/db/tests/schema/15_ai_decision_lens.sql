-- pgTAP — decision lens persistence (PR4)
-- ============================================================================
-- fn_record_execution_decision normalizes the resolver's per-candidate ranking (already carried
-- in decision_json) into queryable ai_decision_candidates rows + stamps the active resolver
-- policy id on ai_decisions — so the admin drilldown can show WHY a model won + which weights
-- were live, without hand-parsing JSON. Graceful: a non-resolver decision (no candidate array)
-- persists no candidate rows. Runs after baseline+heals; rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(8);

-- service_role may write the journal (mirrors the dispatch path).
SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true);
SELECT set_config('t.polid', gen_random_uuid()::text, true);

-- A resolver decision: a two-candidate ranking + the active policy id (the resolver's shape).
SELECT set_config('t.decid',
  public.fn_record_execution_decision(
    jsonb_build_object(
      'clow_purpose', 'lens-test',
      'provider_slug', 'openai', 'model_id', 'gpt-x', 'backend_kind', 'direct_cloud',
      'policy', jsonb_build_object('id', current_setting('t.polid')),
      'candidates', jsonb_build_array(
        jsonb_build_object('provider_slug','openai','model_id','gpt-x','backend_kind','direct_cloud','score',0.70,'reason','bench=0.5 local_bonus=0'),
        jsonb_build_object('provider_slug','local', 'model_id','llama','backend_kind','local_ollama','score',0.40,'reason','bench=0.5 local_bonus=0.2')
      )
    ))::text, true);

SELECT is(
  (SELECT resolver_policy_id FROM ai_decisions WHERE id = current_setting('t.decid')::uuid),
  current_setting('t.polid')::uuid, '(1) the decision row stamps the active resolver_policy_id');
SELECT is(
  (SELECT count(*)::int FROM ai_decision_candidates WHERE decision_id = current_setting('t.decid')::uuid),
  2, '(2) the candidate ranking is normalized into rows');
SELECT is(
  (SELECT provider_slug FROM ai_decision_candidates WHERE decision_id = current_setting('t.decid')::uuid AND is_top),
  'openai', '(3) is_top marks the highest-scoring candidate');
SELECT is(
  (SELECT rank FROM ai_decision_candidates WHERE decision_id = current_setting('t.decid')::uuid AND provider_slug = 'local'),
  2, '(4) rank orders candidates by score (the lower-scored one is rank 2)');
SELECT is(
  (SELECT reason FROM ai_decision_candidates WHERE decision_id = current_setting('t.decid')::uuid AND is_top),
  'bench=0.5 local_bonus=0', '(5) the per-candidate score breakdown is preserved');

-- (6) GRACEFUL: a non-resolver decision (no candidate array) persists no candidate rows.
SELECT set_config('t.decid2',
  public.fn_record_execution_decision(
    jsonb_build_object('clow_purpose','no-cands','provider_slug','y','runtime','human'))::text, true);
SELECT is(
  (SELECT count(*)::int FROM ai_decision_candidates WHERE decision_id = current_setting('t.decid2')::uuid),
  0, '(6) a decision with no candidate array persists no candidate rows (graceful)');

-- (7)(8) the operator read get_ai_decisions_admin: admin-guarded; returns the decision with its
-- candidate ranking nested (the "see the reasoning" surface).
SELECT throws_ok(
  $$ SELECT public.get_ai_decisions_admin() $$, 'P0003', NULL,
  '(7) get_ai_decisions_admin denies a non-admin (service_role is not admin/staff)');

SELECT set_config('t.admin', gen_random_uuid()::text, true);
INSERT INTO aisha_auth.users (id) VALUES (current_setting('t.admin')::uuid);
INSERT INTO public.user_roles (user_id, role) VALUES (current_setting('t.admin')::uuid, 'admin');
SELECT set_config('request.jwt.claims',
  json_build_object('sub', current_setting('t.admin'), 'role','authenticated')::text, true);
SELECT is(
  (SELECT jsonb_array_length(candidates)
     FROM public.get_ai_decisions_admin(200) WHERE decision_id = current_setting('t.decid')::uuid),
  2, '(8) get_ai_decisions_admin returns the decision with its 2-candidate ranking nested');

SELECT * FROM finish();
ROLLBACK;
