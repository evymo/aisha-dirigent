-- Function: insert_model_benchmark

CREATE OR REPLACE FUNCTION public.insert_model_benchmark(p_model_registry_id uuid, p_task_type text, p_relevance numeric DEFAULT NULL::numeric, p_groundedness numeric DEFAULT NULL::numeric, p_safety numeric DEFAULT NULL::numeric, p_coherence numeric DEFAULT NULL::numeric, p_overall numeric DEFAULT NULL::numeric, p_avg_latency_ms integer DEFAULT NULL::integer, p_p95_latency_ms integer DEFAULT NULL::integer, p_avg_tokens_input integer DEFAULT NULL::integer, p_avg_tokens_output integer DEFAULT NULL::integer, p_avg_cost_per_call numeric DEFAULT NULL::numeric, p_success_rate numeric DEFAULT NULL::numeric, p_timeout_rate numeric DEFAULT NULL::numeric, p_error_rate numeric DEFAULT NULL::numeric, p_eval_run_id uuid DEFAULT NULL::uuid, p_sample_count integer DEFAULT 0)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_benchmark_id uuid;
BEGIN
  IF NOT (
    public.is_service_role()
    OR is_admin_or_staff()
  ) THEN
    RAISE EXCEPTION 'Service role or admin required';
  END IF;

  INSERT INTO ai_model_benchmarks (
    model_registry_id, task_type,
    relevance_score, groundedness_score, safety_score, coherence_score, overall_score,
    avg_latency_ms, p95_latency_ms,
    avg_tokens_input, avg_tokens_output, avg_cost_per_call,
    success_rate, timeout_rate, error_rate,
    eval_run_id, sample_count
  ) VALUES (
    p_model_registry_id, p_task_type,
    p_relevance, p_groundedness, p_safety, p_coherence, p_overall,
    p_avg_latency_ms, p_p95_latency_ms,
    p_avg_tokens_input, p_avg_tokens_output, p_avg_cost_per_call,
    p_success_rate, p_timeout_rate, p_error_rate,
    p_eval_run_id, p_sample_count
  )
  ON CONFLICT (model_registry_id, task_type, eval_run_id)
  DO UPDATE SET
    relevance_score = EXCLUDED.relevance_score,
    groundedness_score = EXCLUDED.groundedness_score,
    safety_score = EXCLUDED.safety_score,
    coherence_score = EXCLUDED.coherence_score,
    overall_score = EXCLUDED.overall_score,
    avg_latency_ms = EXCLUDED.avg_latency_ms,
    p95_latency_ms = EXCLUDED.p95_latency_ms,
    avg_tokens_input = EXCLUDED.avg_tokens_input,
    avg_tokens_output = EXCLUDED.avg_tokens_output,
    avg_cost_per_call = EXCLUDED.avg_cost_per_call,
    success_rate = EXCLUDED.success_rate,
    timeout_rate = EXCLUDED.timeout_rate,
    error_rate = EXCLUDED.error_rate,
    sample_count = EXCLUDED.sample_count,
    measured_at = now()
  RETURNING id INTO v_benchmark_id;

  RETURN v_benchmark_id;
END;
$function$;

REVOKE ALL ON FUNCTION insert_model_benchmark(uuid, text, numeric, numeric, numeric, numeric, numeric, integer, integer, integer, integer, numeric, numeric, numeric, numeric, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION insert_model_benchmark(uuid,text,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,integer,numeric,numeric,numeric,numeric,uuid,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION insert_model_benchmark(uuid,text,numeric,numeric,numeric,numeric,numeric,integer,integer,integer,integer,numeric,numeric,numeric,numeric,uuid,integer) TO service_role;
