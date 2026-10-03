-- Source of Truth: log_ai_trace_event
-- Purpose: Log a trace event for an existing AI run. Requires p_run_id (non-NULL).
--          For n8n workflows that may not have a run_id, use log_n8n_trace_event() instead.
-- Used by: ai-chat edge function, internal RPC calls
-- Migration: 20260216_aisha_phase3_router.sql (original)
-- See also: log_n8n_trace_event.sql (wrapper that auto-creates runs)

CREATE OR REPLACE FUNCTION public.log_ai_trace_event(
  p_run_id uuid,
  p_event_type text,
  p_agent_slug text DEFAULT NULL::text,
  p_provider text DEFAULT NULL::text,
  p_operation text DEFAULT NULL::text,
  p_status text DEFAULT 'ok'::text,
  p_duration_ms integer DEFAULT NULL::integer,
  p_cost_json jsonb DEFAULT NULL::jsonb,
  p_request_summary jsonb DEFAULT NULL::jsonb,
  p_response_summary jsonb DEFAULT NULL::jsonb,
  p_error_json jsonb DEFAULT NULL::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  INSERT INTO ai_trace_events (
    run_id, event_type, agent_slug, provider, operation,
    status, duration_ms, cost_json, request_summary, response_summary, error_json
  )
  VALUES (
    p_run_id, p_event_type::ai_event_type, p_agent_slug, p_provider, p_operation,
    p_status, p_duration_ms, p_cost_json, p_request_summary, p_response_summary, p_error_json
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.log_ai_trace_event(uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_ai_trace_event(uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_ai_trace_event(uuid, text, text, text, text, text, integer, jsonb, jsonb, jsonb, jsonb) TO service_role;
