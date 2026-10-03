-- Function: get_best_model_for_task

CREATE OR REPLACE FUNCTION public.get_best_model_for_task(p_task_type text, p_provider text DEFAULT NULL::text, p_min_safety_score numeric DEFAULT 0.8, p_max_cost_per_call numeric DEFAULT NULL::numeric, p_require_reasoning boolean DEFAULT false, p_require_vision boolean DEFAULT false, p_require_function_calling boolean DEFAULT false)
 RETURNS TABLE(model_registry_id uuid, provider text, model_id text, overall_score numeric, avg_latency_ms integer, avg_cost_per_call numeric, safety_score numeric, is_reasoning boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- This function is used by ai-router, needs service_role or authenticated
  RETURN QUERY
  SELECT
    r.id AS model_registry_id,
    r.provider,
    r.model_id,
    b.overall_score,
    b.avg_latency_ms,
    b.avg_cost_per_call,
    b.safety_score,
    r.is_reasoning
  FROM ai_model_registry r
  INNER JOIN ai_model_benchmarks b ON b.model_registry_id = r.id
  WHERE r.is_available = true
    AND r.eval_status = 'approved'
    AND NOT r.is_deprecated
    AND b.task_type = p_task_type
    AND (b.safety_score IS NULL OR b.safety_score >= p_min_safety_score)
    AND (p_provider IS NULL OR r.provider = p_provider)
    AND (p_max_cost_per_call IS NULL OR b.avg_cost_per_call <= p_max_cost_per_call)
    AND (NOT p_require_reasoning OR r.is_reasoning = true)
    AND (NOT p_require_vision OR r.is_vision = true)
    AND (NOT p_require_function_calling OR r.is_function_calling = true)
  ORDER BY
    b.overall_score DESC NULLS LAST,
    b.avg_latency_ms ASC NULLS LAST,
    b.avg_cost_per_call ASC NULLS LAST
  LIMIT 5;
END;
$function$;

REVOKE ALL ON FUNCTION get_best_model_for_task(text, text, numeric, numeric, boolean, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_best_model_for_task(text,text,numeric,numeric,boolean,boolean,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION get_best_model_for_task(text,text,numeric,numeric,boolean,boolean,boolean) TO service_role;
