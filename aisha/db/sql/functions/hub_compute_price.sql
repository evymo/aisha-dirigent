-- ============================================================================
-- Source of Truth: hub_compute_price
-- Popis: The hamburger composer — stack the active, condition-matching layers
--        over price_buy and return {price_buy, price_retail, currency, breakdown}.
--        Conditions: category/brand/product_type/tenant_id/season/weather (exact),
--        min_qty/max_qty/min_age_days/max_age_days/fx_above/fx_below (range).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT (admin/staff or service).
-- Pár: aisha/db/migrations/20260627150000_hub_price_layers.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_compute_price(p_context jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_buy       numeric := COALESCE((p_context->>'price_buy')::numeric, 0);
  v_running   numeric := v_buy;
  v_qty       integer := COALESCE((p_context->>'quantity')::int, 1);
  v_breakdown jsonb := '[]'::jsonb;
  v_layer     public.hub_price_layer;
  v_cond      jsonb;
  v_match     boolean;
  v_delta     numeric;
BEGIN
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  FOR v_layer IN SELECT id, slug, name, layer_kind, value_kind, value, condition, target_kind, target_price_type, target_source_price_type, sort_order, is_active, created_at, updated_at FROM public.hub_price_layer WHERE is_active ORDER BY sort_order, slug LOOP
    v_cond := COALESCE(v_layer.condition, '{}'::jsonb);
    v_match := true;
    IF v_cond ? 'category'     AND COALESCE(p_context->>'category','')     <> (v_cond->>'category')     THEN v_match := false; END IF;
    IF v_cond ? 'brand'        AND COALESCE(p_context->>'brand','')        <> (v_cond->>'brand')        THEN v_match := false; END IF;
    IF v_cond ? 'product_type' AND COALESCE(p_context->>'product_type','') <> (v_cond->>'product_type') THEN v_match := false; END IF;
    IF v_cond ? 'tenant_id'    AND COALESCE(p_context->>'tenant_id','')    <> (v_cond->>'tenant_id')    THEN v_match := false; END IF;
    IF v_cond ? 'season'       AND COALESCE(p_context->>'season','')       <> (v_cond->>'season')       THEN v_match := false; END IF;
    IF v_cond ? 'weather'      AND COALESCE(p_context->>'weather','')      <> (v_cond->>'weather')      THEN v_match := false; END IF;
    IF v_cond ? 'min_qty'      AND v_qty < (v_cond->>'min_qty')::int       THEN v_match := false; END IF;
    IF v_cond ? 'max_qty'      AND v_qty > (v_cond->>'max_qty')::int       THEN v_match := false; END IF;
    IF v_cond ? 'min_age_days' AND COALESCE((p_context->>'age_days')::numeric, 0)   < (v_cond->>'min_age_days')::numeric THEN v_match := false; END IF;
    IF v_cond ? 'max_age_days' AND COALESCE((p_context->>'age_days')::numeric, 1e9) > (v_cond->>'max_age_days')::numeric THEN v_match := false; END IF;
    IF v_cond ? 'fx_above'     AND COALESCE((p_context->>'fx_rate')::numeric, 0)     <= (v_cond->>'fx_above')::numeric    THEN v_match := false; END IF;
    IF v_cond ? 'fx_below'     AND COALESCE((p_context->>'fx_rate')::numeric, 1e9)   >= (v_cond->>'fx_below')::numeric    THEN v_match := false; END IF;

    IF v_match THEN
      v_delta := CASE v_layer.value_kind
        WHEN 'percent'  THEN v_running * v_layer.value / 100.0
        WHEN 'absolute' THEN v_layer.value
        ELSE 0 END;
      v_running := v_running + v_delta;
      v_breakdown := v_breakdown || jsonb_build_object(
        'slug', v_layer.slug, 'name', v_layer.name, 'kind', v_layer.layer_kind,
        'value_kind', v_layer.value_kind, 'value', v_layer.value,
        'delta', round(v_delta, 2), 'running', round(v_running, 2));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'price_buy', v_buy, 'price_retail', round(v_running, 2),
    'currency', COALESCE(p_context->>'currency', public.commerce_base_currency()), 'breakdown', v_breakdown);
END; $$;

REVOKE ALL ON FUNCTION public.hub_compute_price(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_compute_price(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_compute_price(jsonb) TO service_role;
