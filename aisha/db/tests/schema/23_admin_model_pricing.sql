-- pgTAP — admin model registry surfaces + edits the cache-read price (odysseus G1)
-- ============================================================================
-- The admin RPCs gained prompt-cache pricing: the READ RPC now returns
-- cached_input_price_per_m, and the EDIT RPC can override per-model input/output/
-- cached prices. Assertions are signature/return-type based (auth-independent):
--   (1) read RPC still exists (unchanged args) · (2) its return type carries the
--   new column · (3) edit RPC has the new 7-arg signature · (4) the old 4-arg edit
--   overload was dropped (so a 4-arg call is unambiguous). Runs after baseline+heals.
-- The RPC call shape is covered at the app layer by src/tests/hooks/useModelRegistry.test.ts.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

-- (1) admin read RPC exists (args unchanged).
SELECT has_function(
  'public', 'get_model_registry_admin', ARRAY['text','text','boolean'],
  '(1) get_model_registry_admin exists');

-- (2) its RETURNS TABLE now includes cached_input_price_per_m.
SELECT ok(
  pg_get_function_result('public.get_model_registry_admin(text,text,boolean)'::regprocedure)
    LIKE '%cached_input_price_per_m%',
  '(2) get_model_registry_admin returns cached_input_price_per_m');

-- (3) admin edit RPC has the new 7-arg signature (…, numeric, numeric, numeric).
SELECT has_function(
  'public', 'update_model_registry_admin',
  ARRAY['uuid','boolean','boolean','text','numeric','numeric','numeric'],
  '(3) update_model_registry_admin accepts price overrides');

-- (4) the old 4-arg edit overload was dropped (no ambiguity).
SELECT hasnt_function(
  'public', 'update_model_registry_admin', ARRAY['uuid','boolean','boolean','text'],
  '(4) old 4-arg update_model_registry_admin overload removed');

SELECT * FROM finish();
ROLLBACK;
