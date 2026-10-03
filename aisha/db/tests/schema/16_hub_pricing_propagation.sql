-- pgTAP — the hamburger composes a TARGET PROPAGATION PLAN (rule vs simulated)
-- ============================================================================
-- Asserts hub_compose_propagation_plan reuses hub_compute_price's matching and splits
-- the matched layers into target-native RULES (propagate as product_collection_price)
-- vs SIMULATED non-native layers (pushed pre-calculated). Uses the seeded example layers.
-- Run via with-throwaway-db -- psql.
-- ============================================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(9);

SELECT ok(EXISTS(SELECT 1 FROM pg_proc WHERE proname = 'hub_compose_propagation_plan'),
  'hub_compose_propagation_plan exists');

SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);

-- Self-contained under NO_SEED: the example layers are seed DATA
-- (a tenant's own seed) — ensure them inside
-- this rolled-back transaction so the suite also runs against a bare baseline.
INSERT INTO public.hub_price_layer
  (slug, name, layer_kind, value_kind, value, condition, sort_order, target_kind, target_price_type, target_source_price_type) VALUES
  ('winter-season-surcharge', 'Sezónní příplatek (zima)',  'surcharge', 'percent',  15, '{"season":"winter","category":"tyre"}', 10, 'rule',      'retail', NULL),
  ('bulk-tyre-discount',      'Množstevní sleva (≥4 ks)',  'discount',  'percent',  -5, '{"category":"tyre","min_qty":4}',       20, 'simulated', NULL,   NULL),
  ('small-qty-surcharge',     'Příplatek za malé množství','surcharge', 'absolute', 50, '{"max_qty":1}',                         30, 'simulated', NULL,   NULL)
ON CONFLICT (slug) DO NOTHING;

-- the seed data classified the example layers
SELECT is((SELECT target_kind FROM public.hub_price_layer WHERE slug = 'winter-season-surcharge'),
  'rule', 'winter margin is a target-native rule');
SELECT is((SELECT target_kind FROM public.hub_price_layer WHERE slug = 'bulk-tyre-discount'),
  'simulated', 'quantity discount is non-native (simulated) — target qty filters are inactive');

-- compose a plan for a winter tyre, qty 4 (winter rule + bulk qty-discount both match)
DO $$
DECLARE v_plan jsonb;
BEGIN
  v_plan := public.hub_compose_propagation_plan(
    '{"price_buy":800,"category":"tyre","season":"winter","quantity":4,"currency":"CZK"}'::jsonb,
    'COL-77', 'INST-1');
  PERFORM set_config('test.plan', v_plan::text, true);
END $$;

SELECT is((current_setting('test.plan')::jsonb->>'simulated_price')::numeric, 874.00::numeric,
  'simulated_price = the hamburger result (800 +15% -5% = 874.00)');
SELECT is(current_setting('test.plan')::jsonb->'rules'->0->>'slug', 'winter-season-surcharge',
  'the native layer becomes a target-native rule in the plan');
SELECT is((current_setting('test.plan')::jsonb->'rules'->0->>'percentage')::numeric, 15::numeric,
  'the rule carries the target percentage (a product_collection_price shape)');
SELECT is(current_setting('test.plan')::jsonb->'rules'->0->>'price_type', 'retail',
  'the rule targets a REAL target price_type (retail) — verified live: no sell/purchase exists, so a bad name would fail product_collection_price_put with unknown_price_type');
SELECT is(current_setting('test.plan')::jsonb->>'pre_calc_required', 'true',
  'a non-native (simulated) layer applied → pre-calculated price must be pushed');

-- the target_kind CHECK rejects an unknown value
SELECT throws_ok(
  $$INSERT INTO public.hub_price_layer (slug, name, target_kind) VALUES ('bogus-layer','Bogus','nonsense')$$,
  '23514', NULL,
  'target_kind CHECK rejects an unknown propagation kind');

SELECT * FROM finish();
ROLLBACK;
