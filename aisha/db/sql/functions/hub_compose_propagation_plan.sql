-- ============================================================================
-- Source of Truth: hub_compose_propagation_plan
-- Popis: Turn the hamburger composition into a TARGET PROPAGATION PLAN. The commerce
--        target already owns pricing (collection rules + price_calculate); AISHA composes/
--        simulates and propagates AS the user. This reuses hub_compute_price's exact
--        condition-matching (the simulation) and classifies each MATCHED layer:
--          • native ('rule')      → a target-native product_collection_price rule
--                                    (amount/percentage) to set + refresh on the collection;
--          • non-native ('simulated': date/quantity/customer) → folded into the
--                                    simulated price and pushed PRE-CALCULATED (specific_price_put).
--        The connector then drives the target (refresh_prices / specific_price_put) as the
--        federated caller. AISHA never reimplements the target's pricing — it propagates into it.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (service/admin/staff).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_compose_propagation_plan(
  p_context jsonb, p_collection_id text DEFAULT NULL, p_instance_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_sim       jsonb;
  v_entry     jsonb;
  v_layer     public.hub_price_layer;
  v_rules     jsonb := '[]'::jsonb;
  v_simulated jsonb := '[]'::jsonb;
BEGIN
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  -- The hamburger simulation (reuses the exact condition-matching of hub_compute_price).
  v_sim := public.hub_compute_price(p_context);

  -- Classify each MATCHED layer (breakdown = the layers that applied).
  FOR v_entry IN SELECT * FROM jsonb_array_elements(v_sim->'breakdown') LOOP
    SELECT * INTO v_layer FROM public.hub_price_layer WHERE slug = v_entry->>'slug';
    IF v_layer.target_kind = 'simulated' THEN
      v_simulated := v_simulated || jsonb_build_object(
        'slug', v_layer.slug, 'name', v_layer.name, 'delta', v_entry->'delta',
        'reason', 'non-native in the target (date/quantity/customer) — push the pre-calculated price');
    ELSE
      -- target-native product_collection_price rule
      v_rules := v_rules || jsonb_build_object(
        'slug', v_layer.slug, 'name', v_layer.name, 'layer_kind', v_layer.layer_kind,
        'price_type', v_layer.target_price_type, 'source_price_type', v_layer.target_source_price_type,
        'percentage', CASE WHEN v_layer.value_kind = 'percent'  THEN v_layer.value ELSE NULL END,
        'amount',     CASE WHEN v_layer.value_kind = 'absolute' THEN v_layer.value ELSE NULL END,
        'set_with_vat', false);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'collection_id',    p_collection_id,
    'instance_id',      p_instance_id,
    'currency',         v_sim->>'currency',
    'simulated_price',  (v_sim->>'price_retail')::numeric,
    'rules',            v_rules,                              -- set + refresh_prices on the collection
    'simulated_layers', v_simulated,                          -- push the pre-calculated price
    'pre_calc_required', jsonb_array_length(v_simulated) > 0, -- did any non-native layer apply?
    'simulation',       v_sim);
END; $$;

REVOKE ALL ON FUNCTION public.hub_compose_propagation_plan(jsonb,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_compose_propagation_plan(jsonb,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_compose_propagation_plan(jsonb,text,text) TO service_role;
