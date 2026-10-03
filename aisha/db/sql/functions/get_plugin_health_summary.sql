-- =============================================================================
-- get_plugin_health_summary(p_plugin_id, p_hours)
-- =============================================================================
-- Aggregates plugin health events over the last N hours.
-- Returns: total invocations, error count, error rate, P95 latency, last error.
-- Used by WF_PLUGIN_HEALTH_WATCH for canary monitoring + Appsmith dashboard.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_plugin_health_summary(
  p_hours     integer DEFAULT 24,
  p_plugin_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_total   bigint;
  v_errors  bigint;
  v_p95     numeric;
  v_last_error text;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Only admin or staff can view plugin health summary';
  END IF;

  IF p_plugin_id IS NULL THEN
    RAISE EXCEPTION 'p_plugin_id is required';
  END IF;

  -- Total invocations (load + invoke events)
  SELECT count(*)
  INTO v_total
  FROM public.plugin_health_events
  WHERE plugin_id = p_plugin_id
    AND recorded_at >= now() - (p_hours || ' hours')::interval
    AND event_kind IN ('load', 'invoke');

  -- Error count
  SELECT count(*)
  INTO v_errors
  FROM public.plugin_health_events
  WHERE plugin_id = p_plugin_id
    AND recorded_at >= now() - (p_hours || ' hours')::interval
    AND event_kind IN ('error', 'timeout');

  -- P95 latency
  SELECT percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)
  INTO v_p95
  FROM public.plugin_health_events
  WHERE plugin_id = p_plugin_id
    AND recorded_at >= now() - (p_hours || ' hours')::interval
    AND latency_ms IS NOT NULL;

  -- Last error text
  SELECT error_text
  INTO v_last_error
  FROM public.plugin_health_events
  WHERE plugin_id = p_plugin_id
    AND recorded_at >= now() - (p_hours || ' hours')::interval
    AND event_kind IN ('error', 'timeout')
    AND error_text IS NOT NULL
  ORDER BY recorded_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'plugin_id', p_plugin_id,
    'total_invocations', COALESCE(v_total, 0),
    'error_count', COALESCE(v_errors, 0),
    'error_rate', CASE
      WHEN COALESCE(v_total, 0) + COALESCE(v_errors, 0) = 0 THEN 0
      ELSE round(v_errors::numeric / (v_total + v_errors)::numeric, 4)
    END,
    'p95_latency_ms', COALESCE(v_p95, 0),
    'last_error', v_last_error,
    'period_hours', p_hours
  );
END;
$$;

COMMENT ON FUNCTION public.get_plugin_health_summary(integer, uuid) IS
  'Aggregates plugin health over N hours: invocations, errors, P95 latency.';

REVOKE ALL ON FUNCTION public.get_plugin_health_summary(integer, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_plugin_health_summary(integer, uuid) TO authenticated;
