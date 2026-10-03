-- Function: get_model_pricing
-- Return per-model pricing from ai_model_registry.
-- Used by VS Code resource tracker for accurate per-model cost calculation.
-- Source: migration 20260418130100_cost_intelligence_and_hippocampus.sql

CREATE OR REPLACE FUNCTION public.get_model_pricing()
RETURNS jsonb
LANGUAGE plpgsql STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb := '{}'::jsonb;
  v_row record;
BEGIN
  FOR v_row IN
    SELECT
      r.cached_input_price_per_m,
      r.input_price_per_m,
      r.model_id,
      r.output_price_per_m,
      r.provider
    FROM ai_model_registry r
    WHERE r.is_available AND NOT r.is_deprecated
    ORDER BY r.provider, r.model_id
  LOOP
    v_result := v_result || jsonb_build_object(v_row.model_id, jsonb_build_object(
      'cached_input_per_m', v_row.cached_input_price_per_m,
      'input_per_m', v_row.input_price_per_m,
      'output_per_m', v_row.output_price_per_m,
      'provider', v_row.provider
    ));
  END LOOP;

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION get_model_pricing() IS
  'Return per-model pricing from ai_model_registry. '
  'Used by resource tracker for accurate per-model cost calculation.';

REVOKE ALL ON FUNCTION public.get_model_pricing() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_model_pricing() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_model_pricing() TO service_role;
