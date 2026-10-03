-- pgTAP acceptance — AISHA Omni · area: dispatch-capacity
-- ============================================================================
-- Locks the resolver-side half of the /v1 max_tokens hardening: aisha_resolve_clow_backend
-- must surface the RESOLVED model's real capacity + pricing on each candidate, so the Omni
-- /v1 lane can DYNAMICALLY clamp client max_tokens to the model's max_output_tokens and
-- derive a token-aware spend estimate from the pricing — instead of an unbounded client
-- value and a flat $0.02 estimate (the regression-audit MEDIUM finding).
--
-- Seed-independent: checks the function definition emits the keys (a behavioral probe would
-- depend on a resolvable seeded model). Runtime behavior is covered by the omni e2e + a live
-- probe (resolver top → max_output_tokens=16384, pricing for gpt-5-mini).
--
-- ISOLATION: omni/ subdir → omni acceptance runner only. BEGIN…ROLLBACK + pgtap.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(4);

SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure) LIKE '%max_output_tokens%',
  'resolver candidate emits max_output_tokens (dynamic /v1 max_tokens cap source)');

SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure) LIKE '%context_window%',
  'resolver candidate emits context_window');

SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure) LIKE '%input_price_per_m%',
  'resolver candidate emits input_price_per_m (token-aware spend estimate source)');

SELECT ok(
  pg_get_functiondef('public.aisha_resolve_clow_backend(jsonb,jsonb)'::regprocedure) LIKE '%output_price_per_m%',
  'resolver candidate emits output_price_per_m');

SELECT * FROM finish();
ROLLBACK;
