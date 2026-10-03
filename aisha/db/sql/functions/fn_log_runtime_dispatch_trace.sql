-- Function: fn_log_runtime_dispatch_trace
-- Writes ONE ai_trace_events row for an E3 runtime/executor dispatch, carrying the
-- runtime identity the generic insert_ai_trace_event drops: backend_kind, model_id,
-- and decision_id (→ ai_decisions.runtime). This is what makes the executor axis
-- OBSERVABLE — without it the reflection trace shows setup events (from
-- fn_create_workflow_run / compose_context) but never WHICH runtime ran the work.
--
-- Binds to the EXISTING run (p_run_id from the orchestrator) — unlike
-- fn_log_ai_trace_event it does NOT mint a new ai_run. Called by the runtime_dispatch
-- node after executeViaRuntime. Soft by design: a tracing failure must never brick a
-- dispatch, so the caller ignores errors.

CREATE OR REPLACE FUNCTION public.fn_log_runtime_dispatch_trace(
  p_run_id       uuid,
  p_runtime      text,
  p_event_type   text    DEFAULT 'llm_call',
  p_model_id     text    DEFAULT NULL,
  p_backend_kind text    DEFAULT NULL,
  p_decision_id  uuid    DEFAULT NULL,
  p_provider     text    DEFAULT NULL,
  p_status       text    DEFAULT 'ok',
  p_duration_ms  integer DEFAULT NULL,
  p_cost_json    jsonb   DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_event_id uuid;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) != 'service_role' THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '22023';
  END IF;

  IF p_run_id IS NULL THEN
    RAISE EXCEPTION 'p_run_id required' USING ERRCODE = '22023';
  END IF;
  IF p_status NOT IN ('ok', 'error', 'timeout', 'skipped') THEN
    RAISE EXCEPTION 'Invalid status: %', p_status USING ERRCODE = '22023';
  END IF;

  INSERT INTO ai_trace_events (
    run_id, event_type, agent_slug, provider, operation,
    status, duration_ms, cost_json,
    decision_id, model_id, backend_kind
  )
  VALUES (
    p_run_id, p_event_type::ai_event_type, 'runtime_dispatch', p_provider,
    format('execute via %s', p_runtime),
    p_status, p_duration_ms, p_cost_json,
    p_decision_id, p_model_id, p_backend_kind
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_log_runtime_dispatch_trace(uuid, text, text, text, text, uuid, text, text, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_log_runtime_dispatch_trace(uuid, text, text, text, text, uuid, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_log_runtime_dispatch_trace(uuid, text, text, text, text, uuid, text, text, integer, jsonb) TO service_role;

COMMENT ON FUNCTION public.fn_log_runtime_dispatch_trace(uuid, text, text, text, text, uuid, text, text, integer, jsonb) IS
  'E3 observability — one ai_trace_events row per runtime dispatch carrying backend_kind/model_id/decision_id (the executor identity the generic tracer drops), bound to the existing reflection run.';
