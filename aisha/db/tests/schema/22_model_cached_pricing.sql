-- pgTAP — prompt-cache read pricing carried end-to-end (odysseus G1)
-- ============================================================================
-- ai_model_registry.cached_input_price_per_m was exposed by get_model_pricing()
-- but never written. This proves: (1) upsert_discovered_model now carries the
-- cached rate (the old 15-arg overload is gone so a 15-arg call is unambiguous),
-- (2) an upsert persists it, (3) get_model_pricing() surfaces it, and (4) a later
-- scan without the rate does not wipe it (COALESCE).
-- 2026-09-13: signatura má 17 argumentů — přibyl p_embedding_dimensions (discovery
-- měří rozměr embeddingu). Předchozí 16-arg overload se DROPuje, jinak by volání
-- s 16 argumenty bylo nejednoznačné; test to drží stejně jako u 15-arg.
-- Runs after baseline+heals; rolled back. Fixture-based (no seed dependency).
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(7);

-- The upsert is service-role gated; present a service_role claim for this tx.
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- (1) the current 17-arg signature (…, jsonb, numeric, integer) exists — it still
--     carries p_cached_input_price_per_m (16th) and adds p_embedding_dimensions.
SELECT has_function(
  'public', 'upsert_discovered_model',
  ARRAY['text','text','text','text','boolean','boolean','boolean','boolean','boolean','boolean','integer','integer','numeric','numeric','jsonb','numeric','integer'],
  '(1) upsert_discovered_model carries p_cached_input_price_per_m');

-- (2b) the previous 16-arg overload was dropped (no ambiguous overload remains).
SELECT hasnt_function(
  'public', 'upsert_discovered_model',
  ARRAY['text','text','text','text','boolean','boolean','boolean','boolean','boolean','boolean','integer','integer','numeric','numeric','jsonb','numeric'],
  '(2b) previous 16-arg upsert_discovered_model overload removed');

-- (2) the old 15-arg signature was dropped (no ambiguous overload remains).
SELECT hasnt_function(
  'public', 'upsert_discovered_model',
  ARRAY['text','text','text','text','boolean','boolean','boolean','boolean','boolean','boolean','integer','integer','numeric','numeric','jsonb'],
  '(2) old 15-arg upsert_discovered_model overload removed');

-- Insert a discovered model WITH a cached rate.
SELECT lives_ok(
  $$ SELECT public.upsert_discovered_model(
       'pgtap-prov', 'pgtap-cache-model', 'PgTAP Cache Model', 'pgtap-fam',
       true, false, false, false, true, false,
       200000, 16384,
       3.0, 15.0, '{}'::jsonb, 0.30) $$,
  '(3a) upsert with cached rate runs');

-- (3) the cached rate landed on the row.
SELECT is(
  (SELECT cached_input_price_per_m FROM public.ai_model_registry
    WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-cache-model'),
  0.30::numeric,
  '(3) cached_input_price_per_m persisted by upsert');

-- (4) get_model_pricing() surfaces the cached rate for that model.
SELECT is(
  ((public.get_model_pricing() -> 'pgtap-cache-model') ->> 'cached_input_per_m')::numeric,
  0.30::numeric,
  '(4) get_model_pricing() exposes cached_input_per_m');

-- (5) a later scan WITHOUT the rate must not wipe the existing value (COALESCE).
SELECT public.upsert_discovered_model(
  'pgtap-prov', 'pgtap-cache-model', NULL, NULL,
  true, false, false, false, true, false,
  200000, 16384, 3.0, 15.0, '{}'::jsonb, NULL);
SELECT is(
  (SELECT cached_input_price_per_m FROM public.ai_model_registry
    WHERE provider = 'pgtap-prov' AND model_id = 'pgtap-cache-model'),
  0.30::numeric,
  '(5) re-scan without cached rate preserves the existing value (COALESCE)');

SELECT * FROM finish();
ROLLBACK;
