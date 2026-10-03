-- Function: simulate_model_tier_cost
-- Simulate monthly cost for current model tier assignments.
-- Uses real pricing from ai_model_registry and average token usage from traces.
-- Source: migration 20260418130100_cost_intelligence_and_hippocampus.sql

CREATE OR REPLACE FUNCTION public.simulate_model_tier_cost(
  p_monthly_call_count integer DEFAULT 10000,
  p_task_type text DEFAULT 'chat'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tiers jsonb;
  v_result jsonb := '{}'::jsonb;
  v_tier text;
  v_model_id text;
  v_model record;
  v_avg_tokens_in integer;
  v_avg_tokens_out integer;
  v_cost_per_call numeric;
  v_monthly_cost numeric;
  v_tier_keys text[] := ARRAY['greeting','simple','moderate','complex','deep_analysis'];
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = 'P0003';
  END IF;

  -- Get current tier assignments
  v_tiers := get_adaptive_model_tiers(p_task_type);

  -- Get average tokens from recent traces (or sensible defaults)
  SELECT
    COALESCE(avg((te.cost_json->>'tokens_in')::integer) FILTER (
      WHERE te.cost_json->>'tokens_in' IS NOT NULL), 500)::integer,
    COALESCE(avg((te.cost_json->>'tokens_out')::integer) FILTER (
      WHERE te.cost_json->>'tokens_out' IS NOT NULL), 200)::integer
  INTO v_avg_tokens_in, v_avg_tokens_out
  FROM ai_trace_events te
  WHERE te.created_at > now() - interval '7 days'
    AND te.cost_json IS NOT NULL;

  -- Calculate cost for each tier
  FOREACH v_tier IN ARRAY v_tier_keys
  LOOP
    v_model_id := v_tiers ->> v_tier;
    IF v_model_id IS NOT NULL THEN
      SELECT
        r.input_price_per_m,
        r.model_id,
        r.output_price_per_m,
        r.provider
      INTO v_model
      FROM ai_model_registry r
      WHERE r.model_id = v_model_id
      LIMIT 1;

      IF v_model IS NOT NULL THEN
        v_cost_per_call := (
          COALESCE(v_model.input_price_per_m, 0) * v_avg_tokens_in / 1000000.0 +
          COALESCE(v_model.output_price_per_m, 0) * v_avg_tokens_out / 1000000.0
        );
        v_monthly_cost := v_cost_per_call * p_monthly_call_count;

        v_result := v_result || jsonb_build_object(v_tier, jsonb_build_object(
          'avg_tokens_in', v_avg_tokens_in,
          'avg_tokens_out', v_avg_tokens_out,
          'cost_per_call', round(v_cost_per_call, 6),
          'model_id', v_model_id,
          'monthly_cost', round(v_monthly_cost, 2),
          'provider', v_model.provider
        ));
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'monthly_call_count', p_monthly_call_count,
    'simulation_date', now(),
    'task_type', p_task_type,
    'tiers', v_result,
    'total_monthly', round((
      SELECT COALESCE(sum((t.value->>'monthly_cost')::numeric), 0)
      FROM jsonb_each(v_result) t
    ), 2)
  );
END;
$function$;

COMMENT ON FUNCTION simulate_model_tier_cost(integer, text) IS
  'Simulate monthly cost for current model tier assignments. '
  'Uses real pricing from ai_model_registry and average token usage from traces.';

REVOKE ALL ON FUNCTION public.simulate_model_tier_cost(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.simulate_model_tier_cost(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.simulate_model_tier_cost(integer, text) TO service_role;
