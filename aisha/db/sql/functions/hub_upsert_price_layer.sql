-- ============================================================================
-- Source of Truth: hub_upsert_price_layer
-- Popis: Upsert a hamburger price layer (admin/staff), keyed by slug.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627150000_hub_price_layers.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_upsert_price_layer(p_payload jsonb)
RETURNS public.hub_price_layer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.hub_price_layer;
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized: admin or staff required'; END IF;
  INSERT INTO public.hub_price_layer (slug, name, layer_kind, value_kind, value, condition,
          target_kind, target_price_type, target_source_price_type, sort_order, is_active)
  VALUES (p_payload->>'slug', p_payload->>'name',
          COALESCE(p_payload->>'layer_kind','surcharge'), COALESCE(p_payload->>'value_kind','percent'),
          COALESCE((p_payload->>'value')::numeric, 0), COALESCE(p_payload->'condition','{}'::jsonb),
          COALESCE(p_payload->>'target_kind','rule'), p_payload->>'target_price_type',
          p_payload->>'target_source_price_type',
          COALESCE((p_payload->>'sort_order')::int, 100), COALESCE((p_payload->>'is_active')::boolean, true))
  ON CONFLICT (slug) DO UPDATE SET
    name=EXCLUDED.name, layer_kind=EXCLUDED.layer_kind, value_kind=EXCLUDED.value_kind,
    value=EXCLUDED.value, condition=EXCLUDED.condition,
    target_kind=EXCLUDED.target_kind, target_price_type=EXCLUDED.target_price_type,
    target_source_price_type=EXCLUDED.target_source_price_type, sort_order=EXCLUDED.sort_order,
    is_active=EXCLUDED.is_active, updated_at=now()
  RETURNING * INTO v_row;
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.hub_upsert_price_layer(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_upsert_price_layer(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_upsert_price_layer(jsonb) TO service_role;
