-- Function: fn_log_dev_signal
-- Purpose: Log development signals from VS Code extension (terminal failures, compliance violations).
--          Wraps fn_log_ai_trace_event with dev_signal event_type and structured payload.
-- Used by: aisha-dirigent VS Code extension (terminal-watcher, copilot-watcher)
-- Migration: 20260406120000_add_dev_signal_event_type.sql

CREATE OR REPLACE FUNCTION public.fn_log_dev_signal(
  p_signal_type text,
  p_severity text DEFAULT 'info'::text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_agent_slug text DEFAULT 'dirigent'::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_result jsonb;
  v_valid_types text[] := ARRAY[
    'compliance_violation',
    'terminal_failure',
    'terminal_success',
    'build_result',
    'test_result'
  ];
BEGIN
  -- Validate signal_type
  IF NOT (p_signal_type = ANY(v_valid_types)) THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'Invalid signal_type: ' || p_signal_type ||
                 '. Must be one of: ' || array_to_string(v_valid_types, ', ')
    );
  END IF;

  -- Validate severity
  IF p_severity NOT IN ('info', 'warning', 'error', 'critical') THEN
    RETURN jsonb_build_object(
      'status', 'error',
      'message', 'Invalid severity: ' || p_severity
    );
  END IF;

  -- Delegate to existing fn_log_ai_trace_event (creates ai_run + ai_trace_event)
  v_result := fn_log_ai_trace_event(
    p_event_type := 'dev_signal',
    p_agent_slug := p_agent_slug,
    p_operation := p_signal_type,
    p_status := CASE
      WHEN p_severity IN ('error', 'critical') THEN 'error'
      WHEN p_severity = 'warning' THEN 'warning'
      ELSE 'ok'
    END,
    p_request_summary := jsonb_build_object(
      'signal_type', p_signal_type,
      'severity', p_severity,
      'payload', p_payload,
      'source', 'vscode_extension'
    )
  );

  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION fn_log_dev_signal(text, text, jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_log_dev_signal(text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION fn_log_dev_signal(text, text, jsonb, text) TO service_role;
