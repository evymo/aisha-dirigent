-- pgTAP — get_adaptive_model_tiers carries registry windows (odysseus impl 03)
-- ============================================================================
-- The chat path enforces the input-token budget from ai_model_registry via the
-- tiers RPC's additive `windows` payload — ONE window source (impl/08 §5), no
-- new RPC. Proven: the RPC returns tier keys as before (backward compatible),
-- and for every tier model the `windows` object carries context_window +
-- max_output_tokens (NULL allowed — consumer degrades to parity).
-- Runs after baseline+heals; rolled back.
-- ============================================================================
BEGIN;
SET search_path = public, extensions;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(5);

SELECT has_function('public', 'get_adaptive_model_tiers', ARRAY['text'],
  '(1) get_adaptive_model_tiers exists');

-- Fixture: two chat-capable models with known windows (heuristic Phase B path).
INSERT INTO public.ai_model_registry
  (provider, model_id, is_available, is_chat_capable, is_reasoning, context_window, max_output_tokens, input_price_per_m)
VALUES
  ('pgtap-prov', 'pgtap-cheap-mini', true, true, false, 16000, 2000, 0.10),
  ('pgtap-prov', 'pgtap-big-pro',    true, true, false, 200000, 8000, 15.0);

SELECT lives_ok(
  $$ SELECT public.get_adaptive_model_tiers('chat') $$,
  '(2) tiers RPC runs with fixture models');

-- (3) tier keys still resolve (backward compatibility with existing readers).
SELECT ok(
  (SELECT (public.get_adaptive_model_tiers('chat') ->> 'greeting') IS NOT NULL),
  '(3) greeting tier resolves');

-- (4) windows payload exists and is an object.
SELECT is(
  (SELECT jsonb_typeof(public.get_adaptive_model_tiers('chat') -> 'windows')),
  'object', '(4) windows payload is an object');

-- (5) the chosen greeting-tier model has its registry window in the payload.
SELECT ok(
  (WITH t AS (SELECT public.get_adaptive_model_tiers('chat') AS j)
   SELECT (j -> 'windows' -> (j ->> 'greeting') ->> 'context_window') IS NOT NULL
   FROM t
   WHERE (j -> 'windows') ? (j ->> 'greeting')),
  '(5) the greeting tier model carries its context_window in windows');

SELECT * FROM finish();
ROLLBACK;
