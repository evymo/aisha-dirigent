-- Function: fn_log_ai_trace_event
-- Log an AI trace event with optional cost data.
-- Source: migration 20260418130100_cost_intelligence_and_hippocampus.sql
-- Note: p_event_type defaults to 'dirigent_action' (a valid ai_event_type
--   member that pairs with the 'dirigent' p_agent_slug default). It is cast
--   p_event_type::ai_event_type at the INSERT below, so the default MUST be a
--   real enum member. The earlier 'system_event' default was NOT a member of
--   ai_event_type (it belongs to journal_action_type), so any caller omitting
--   p_event_type failed with `invalid input value for enum ai_event_type`.
--   Repaired in migration 20260602120000_fix_trace_event_enum_mismatch.sql.

CREATE OR REPLACE FUNCTION public.fn_log_ai_trace_event(
  p_agent_slug text DEFAULT 'dirigent'::text,
  p_cost_json jsonb DEFAULT NULL,
  p_duration_ms integer DEFAULT 0,
  p_event_type text DEFAULT 'dirigent_action'::text,
  p_operation text DEFAULT NULL::text,
  p_request_summary jsonb DEFAULT '{}'::jsonb,
  p_response_summary jsonb DEFAULT '{}'::jsonb,
  p_status text DEFAULT 'ok'::text
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_event_id uuid;
  v_run_id uuid;
BEGIN
  -- Create a minimal ai_run for FK
  v_run_id := gen_random_uuid();
  -- §16: platform/system run → platform sentinel story (ai_runs.story_id NOT NULL).
  INSERT INTO ai_runs (id, story_id, cost_total_json, finished_at, kind, metadata, started_at, status)
  VALUES (
    v_run_id,
    public.ensure_stack_default_story(),
    COALESCE(p_cost_json, '{"usd": 0}'::jsonb),
    now(),
    'proactive',
    p_request_summary,
    now(),
    'succeeded'
  );

  INSERT INTO ai_trace_events (
    agent_slug,
    cost_json,
    created_at,
    duration_ms,
    event_type,
    operation,
    request_summary,
    response_summary,
    run_id,
    status
  ) VALUES (
    p_agent_slug,
    p_cost_json,
    now(),
    p_duration_ms,
    p_event_type::ai_event_type,
    p_operation,
    p_request_summary,
    p_response_summary,
    v_run_id,
    p_status
  )
  RETURNING id INTO v_event_id;

  RETURN jsonb_build_object(
    'event_id', v_event_id,
    'run_id', v_run_id,
    'status', 'logged'
  );
END;
$function$;

REVOKE ALL ON FUNCTION fn_log_ai_trace_event(text, jsonb, integer, text, text, jsonb, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_log_ai_trace_event(text, jsonb, integer, text, text, jsonb, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_log_ai_trace_event(text, jsonb, integer, text, text, jsonb, jsonb, text) TO service_role;
