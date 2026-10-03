-- Function: get_model_registry_admin

-- RETURNS TABLE gains cached_input_price_per_m (odysseus G1) so the admin surfaces
-- the prompt-cache read rate. A column change to a RETURNS TABLE cannot go through
-- CREATE OR REPLACE — drop the (unchanged-arg) function first, then recreate.
DROP FUNCTION IF EXISTS public.get_model_registry_admin(text, text, boolean);

CREATE OR REPLACE FUNCTION public.get_model_registry_admin(p_provider text DEFAULT NULL::text, p_eval_status text DEFAULT NULL::text, p_available_only boolean DEFAULT true)
 RETURNS TABLE(id uuid, provider text, model_id text, display_name text, model_family text, is_reasoning boolean, is_vision boolean, is_function_calling boolean, context_window integer, input_price_per_m numeric, output_price_per_m numeric, cached_input_price_per_m numeric, is_available boolean, is_deprecated boolean, eval_status text, latest_eval_score numeric, latest_eval_at timestamptz, first_seen_at timestamptz, last_seen_at timestamptz, best_task_type text, best_task_score numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin or staff role required';
  END IF;

  RETURN QUERY
  SELECT
    r.id,
    r.provider,
    r.model_id,
    r.display_name,
    r.model_family,
    r.is_reasoning,
    r.is_vision,
    r.is_function_calling,
    r.context_window,
    r.input_price_per_m,
    r.output_price_per_m,
    r.cached_input_price_per_m,
    r.is_available,
    r.is_deprecated,
    r.eval_status,
    r.latest_eval_score,
    r.latest_eval_at,
    r.first_seen_at,
    r.last_seen_at,
    b.task_type AS best_task_type,
    b.overall_score AS best_task_score
  FROM ai_model_registry r
  LEFT JOIN LATERAL (
    SELECT bm.task_type, bm.overall_score
    FROM ai_model_benchmarks bm
    WHERE bm.model_registry_id = r.id
    ORDER BY bm.overall_score DESC NULLS LAST
    LIMIT 1
  ) b ON true
  WHERE (p_provider IS NULL OR r.provider = p_provider)
    AND (p_eval_status IS NULL OR r.eval_status = p_eval_status)
    AND (NOT p_available_only OR r.is_available = true)
  ORDER BY r.provider, r.model_family, r.model_id;
END;
$function$;

REVOKE ALL ON FUNCTION get_model_registry_admin(text, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_model_registry_admin(text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION get_model_registry_admin(text,text,boolean) TO service_role;
