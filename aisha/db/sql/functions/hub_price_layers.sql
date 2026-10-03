-- ============================================================================
-- Source of Truth: hub_price_layers
-- Popis: List the hamburger price layers for the cockpit (admin/staff).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627150000_hub_price_layers.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_price_layers(p_limit int DEFAULT 200)
RETURNS SETOF hub_price_layer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized: admin or staff required'; END IF;
  RETURN QUERY SELECT id, slug, name, layer_kind, value_kind, value, condition, target_kind, target_price_type, target_source_price_type, sort_order, is_active, created_at, updated_at FROM public.hub_price_layer ORDER BY sort_order, slug LIMIT GREATEST(p_limit,1);
END; $$;

REVOKE ALL ON FUNCTION public.hub_price_layers(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_price_layers(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_price_layers(int) TO service_role;
