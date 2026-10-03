-- Source of Truth: log_n8n_trace_event
-- Wrapper for n8n workflows to log trace events with auto ai_run creation.
-- When p_run_id IS NULL, auto-creates an ai_run and uses that run_id.

CREATE OR REPLACE FUNCTION log_n8n_trace_event(
  p_event_type text,
  p_run_id uuid DEFAULT NULL,
  p_run_kind text DEFAULT 'chat',
  p_agent_slug text DEFAULT NULL,
  p_provider text DEFAULT NULL,
  p_operation text DEFAULT NULL,
  p_status text DEFAULT 'ok',
  p_duration_ms int DEFAULT NULL,
  p_cost_json jsonb DEFAULT NULL,
  p_request_summary jsonb DEFAULT NULL,
  p_response_summary jsonb DEFAULT NULL,
  p_error_json jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_run_id uuid;
  v_event_id uuid;
  v_run_created boolean := false;
BEGIN
  IF p_run_id IS NOT NULL THEN
    v_run_id := p_run_id;
  ELSE
    -- §16: platform/system run → platform sentinel story (ai_runs.story_id NOT NULL).
    INSERT INTO ai_runs (story_id, kind, status, metadata)
    VALUES (
      public.ensure_stack_default_story(),
      COALESCE(p_run_kind, 'chat'),
      'running',
      jsonb_build_object(
        'source', 'n8n',
        'agent_slug', COALESCE(p_agent_slug, 'unknown'),
        'auto_created', true
      )
    )
    RETURNING id INTO v_run_id;
    v_run_created := true;
  END IF;

  INSERT INTO ai_trace_events (
    run_id, event_type, agent_slug, provider, operation,
    status, duration_ms, cost_json, request_summary, response_summary, error_json
  )
  VALUES (
    v_run_id,
    p_event_type::ai_event_type,
    p_agent_slug,
    p_provider,
    p_operation,
    p_status,
    p_duration_ms,
    p_cost_json,
    p_request_summary,
    p_response_summary,
    p_error_json
  )
  RETURNING id INTO v_event_id;

  IF v_run_created THEN
    UPDATE ai_runs
    SET status = 'succeeded', finished_at = now()
    WHERE id = v_run_id;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'run_id', v_run_id,
    'run_created', v_run_created
  );
END;
$$;

REVOKE ALL ON FUNCTION log_n8n_trace_event(text, uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION log_n8n_trace_event(text, uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION log_n8n_trace_event(text, uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) TO service_role;

COMMENT ON FUNCTION log_n8n_trace_event(text, uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) IS
  'Wrapper for n8n workflows to log trace events. Auto-creates ai_run when '
  'p_run_id is NULL. Returns { event_id, run_id, run_created }.';
