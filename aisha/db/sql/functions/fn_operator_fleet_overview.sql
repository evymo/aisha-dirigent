-- Function: public.fn_operator_fleet_overview  —  operator observability, live fleet snapshot
-- A single read RPC that aggregates "what is happening now" across the orchestration organism, for
-- the operator dashboard (Appsmith aisha-ops + Workbench monitoring). Complements ai_agent_metrics_hourly
-- (hourly buckets) with an on-demand fleet-wide rollup over a sliding window.
--
-- Derived over the SINGLE sources of truth (no new state): ai_runs, ai_decisions, ai_trace_events,
-- improvement_proposals, ai_model_reliability. STABLE, read-only.
-- Security: SECURITY DEFINER; service_role (dashboard backend) or admin/staff only (cross-story fleet view).

CREATE OR REPLACE FUNCTION public.fn_operator_fleet_overview(p_window_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service boolean := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
                          OR COALESCE(current_setting('role', true), '') = 'service_role';
  v_is_admin   boolean := COALESCE(public.is_admin_or_staff(auth.uid()), false);
  v_since      timestamptz := now() - make_interval(hours => GREATEST(p_window_hours, 1));
  v_result     jsonb;
BEGIN
  IF NOT (v_is_service OR v_is_admin) THEN
    RAISE EXCEPTION 'Not authorized: service_role or admin/staff required' USING ERRCODE = '42501';
  END IF;

  SELECT jsonb_build_object(
    'window_hours', GREATEST(p_window_hours, 1),
    'generated_at', now(),
    -- run lifecycle distribution
    'runs_by_status', COALESCE((
      SELECT jsonb_object_agg(status, c)
      FROM (SELECT status, count(*) AS c FROM public.ai_runs WHERE started_at >= v_since GROUP BY status) s
    ), '{}'::jsonb),
    -- which executors are being chosen (the brain's output)
    'decisions_by_runtime', COALESCE((
      SELECT jsonb_object_agg(runtime, c)
      FROM (SELECT runtime, count(*) AS c FROM public.ai_decisions WHERE created_at >= v_since GROUP BY runtime) d
    ), '{}'::jsonb),
    -- dispatch health (latency / cost / errors)
    'dispatch', (
      SELECT jsonb_build_object(
        'llm_calls',      count(*) FILTER (WHERE event_type = 'llm_call'),
        'errors',         count(*) FILTER (WHERE status = 'error'),
        'avg_latency_ms', COALESCE(avg(duration_ms)::int, 0),
        'total_cost', COALESCE(round(sum(NULLIF(cost_json->>'total', '')::numeric), 6), 0)
      ) FROM public.ai_trace_events WHERE created_at >= v_since
    ),
    -- governance: proposals awaiting / decided
    'proposals_by_status', COALESCE((
      SELECT jsonb_object_agg(status, c)
      FROM (SELECT status, count(*) AS c FROM public.improvement_proposals WHERE created_at >= v_since GROUP BY status) p
    ), '{}'::jsonb),
    'pending_proposals', (
      SELECT count(*) FROM public.improvement_proposals WHERE status IN ('pending', 'pending_review')
    ),
    -- reactive learning substrate size
    'reliability_rows', (SELECT count(*) FROM public.ai_model_reliability)
  ) INTO v_result;

  RETURN v_result;
END $$;

COMMENT ON FUNCTION public.fn_operator_fleet_overview(int) IS
  'Operator observability: live fleet-wide snapshot (runs by status, decisions by runtime, dispatch latency/cost/errors, proposals by status, pending approvals, reliability size) over a sliding window. Read-only over SoT; feeds the Appsmith aisha-ops + Workbench operator views. service_role/admin only.';

REVOKE ALL ON FUNCTION public.fn_operator_fleet_overview(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_operator_fleet_overview(int) TO authenticated, service_role;
