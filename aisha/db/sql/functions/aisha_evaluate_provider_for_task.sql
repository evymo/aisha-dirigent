-- Function: aisha_evaluate_provider_for_task
-- AISHA's internal provider scorer. Given a task description + task_kind,
-- returns per-(provider × model) scores so AISHA can reason about *why* it
-- picked a specific backend without running the full clow resolver.
--
-- Used by:
--   - Admin dashboard (Appsmith) to inspect AISHA's current preferences
--   - WF_MODEL_BENCHMARK n8n workflow to compare benchmarks pre/post update
--   - Debugging: "why did AISHA pick model X for this clow?"

CREATE OR REPLACE FUNCTION public.aisha_evaluate_provider_for_task(
  p_task_kind text,
  p_filters jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  provider_slug text,
  backend_kind text,
  model_id text,
  cost_class text,
  overall_score numeric,
  is_available boolean,
  health_status text,
  bench_relevance numeric,
  bench_latency_ms integer,
  bench_success_rate numeric,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
STABLE
AS $$
DECLARE
  v_include_local      boolean := COALESCE((p_filters->>'include_local')::boolean, true);
  v_include_mcp        boolean := COALESCE((p_filters->>'include_mcp')::boolean, true);
  v_only_cost_class    text    := p_filters->>'only_cost_class';
  v_requires_tools     boolean := COALESCE((p_filters->>'requires_tools')::boolean, false);
  v_requires_vision    boolean := COALESCE((p_filters->>'requires_vision')::boolean, false);
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    p.slug         AS provider_slug,
    p.backend_kind AS backend_kind,
    r.model_id     AS model_id,
    p.cost_class   AS cost_class,
    COALESCE(b.overall_score, 0.5) AS overall_score,
    r.is_available AS is_available,
    p.last_health_status AS health_status,
    COALESCE((b.scores->>'relevance')::numeric, 0.0) AS bench_relevance,
    COALESCE(b.avg_latency_ms, 0) AS bench_latency_ms,
    COALESCE(b.success_rate, 0.0) AS bench_success_rate,
    format(
      'provider=%s/%s, kind=%s, cost=%s, health=%s, bench_score=%.2f',
      p.slug, r.model_id, p.backend_kind, p.cost_class, p.last_health_status,
      COALESCE(b.overall_score, 0.5)
    ) AS reason
  FROM public.ai_provider_registry p
  JOIN public.ai_model_registry r
    ON COALESCE(r.provider_registry_id, NULL) = p.id
    OR r.provider = p.slug
  LEFT JOIN public.ai_model_benchmarks b
    ON b.model_registry_id = r.id AND b.task_type = p_task_kind
  WHERE p.is_enabled
    AND r.is_available AND NOT r.is_deprecated
    AND (v_include_local OR p.backend_kind NOT IN ('local_ollama', 'local_vllm'))
    AND (v_include_mcp OR p.backend_kind != 'mcp_server')
    AND (v_only_cost_class IS NULL OR p.cost_class = v_only_cost_class)
    AND (NOT v_requires_tools OR r.is_function_calling)
    AND (NOT v_requires_vision OR r.is_vision)
  ORDER BY COALESCE(b.overall_score, 0.5) DESC,
           CASE p.cost_class WHEN 'budget' THEN 1 WHEN 'standard' THEN 2 WHEN 'premium' THEN 3 ELSE 4 END;
END;
$$;

COMMENT ON FUNCTION public.aisha_evaluate_provider_for_task(text, jsonb) IS
  'AISHA provider/model scorer for a given task_kind. Read-only, STABLE. '
  'Used by admin UI + debug + WF_MODEL_BENCHMARK comparison.';

REVOKE ALL ON FUNCTION public.aisha_evaluate_provider_for_task(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.aisha_evaluate_provider_for_task(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.aisha_evaluate_provider_for_task(text, jsonb) TO service_role;
