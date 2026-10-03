-- Function: record_model_benchmark
-- Records a QUALITY benchmark for (model, task_type) with REPLACE semantics: it first
-- deletes any prior row for that exact pair, then inserts the fresh scores. This is the
-- write-path for the benchmark runner (the real quality eval, beyond the smoke
-- self-test). insert_model_benchmark APPENDS, but the resolver LEFT JOINs
-- ai_model_benchmarks ON task_type = v_task_kind with NO dedup — so two rows for the
-- same (model, task_type) would BOTH become candidates and a stale run could skew the
-- ranking. Replace keeps exactly one CURRENT score per pair. service_role only.

CREATE OR REPLACE FUNCTION public.record_model_benchmark(
  p_model_registry_id uuid,
  p_task_type         text,
  p_relevance         numeric DEFAULT NULL,
  p_groundedness      numeric DEFAULT NULL,
  p_safety            numeric DEFAULT NULL,
  p_coherence         numeric DEFAULT NULL,
  p_overall           numeric DEFAULT NULL,
  p_avg_latency_ms    integer DEFAULT NULL,
  p_avg_tokens_input  integer DEFAULT NULL,
  p_avg_tokens_output integer DEFAULT NULL,
  p_avg_cost_per_call numeric DEFAULT NULL,
  p_success_rate      numeric DEFAULT NULL,
  p_eval_run_id       uuid    DEFAULT NULL,
  p_sample_count      integer DEFAULT 1
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'service_role required' USING ERRCODE = '22023';
  END IF;
  IF p_model_registry_id IS NULL OR p_task_type IS NULL THEN
    RAISE EXCEPTION 'p_model_registry_id + p_task_type required' USING ERRCODE = '22023';
  END IF;

  -- Replace → exactly one CURRENT benchmark per (model, task_type).
  DELETE FROM ai_model_benchmarks
  WHERE model_registry_id = p_model_registry_id AND task_type = p_task_type;

  INSERT INTO ai_model_benchmarks (
    model_registry_id, task_type, relevance_score, groundedness_score, safety_score,
    coherence_score, overall_score, avg_latency_ms, avg_tokens_input, avg_tokens_output,
    avg_cost_per_call, success_rate, eval_run_id, sample_count
  ) VALUES (
    p_model_registry_id, p_task_type, p_relevance, p_groundedness, p_safety,
    p_coherence, p_overall, p_avg_latency_ms, p_avg_tokens_input, p_avg_tokens_output,
    p_avg_cost_per_call, p_success_rate, p_eval_run_id, COALESCE(p_sample_count, 1)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_model_benchmark(uuid, text, numeric, numeric, numeric, numeric, numeric, integer, integer, integer, numeric, numeric, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_model_benchmark(uuid, text, numeric, numeric, numeric, numeric, numeric, integer, integer, integer, numeric, numeric, uuid, integer) TO service_role;

COMMENT ON FUNCTION public.record_model_benchmark(uuid, text, numeric, numeric, numeric, numeric, numeric, integer, integer, integer, numeric, numeric, uuid, integer) IS
  'Quality benchmark write-path with REPLACE semantics (one current row per model+task_type) so the resolver score JOIN is never skewed by a stale run. service_role only.';
