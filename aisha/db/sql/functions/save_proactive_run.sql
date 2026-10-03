CREATE OR REPLACE FUNCTION save_proactive_run(
  p_trigger_definition_id uuid,
  p_user_id uuid,
  p_source_record_id uuid DEFAULT NULL,
  p_source_data jsonb DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_ai_run_id uuid DEFAULT NULL,
  p_output_text text DEFAULT NULL,
  p_output_data jsonb DEFAULT NULL,
  p_action_taken text DEFAULT NULL,
  p_action_result jsonb DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL,
  p_completed_at timestamptz DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_tokens_input integer DEFAULT 0,
  p_tokens_output integer DEFAULT 0,
  p_error_message text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := public.is_service_role();
  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  INSERT INTO ai_proactive_runs (
    trigger_definition_id, user_id, source_record_id, source_data,
    status, ai_run_id, output_text, output_data,
    action_taken, action_result,
    started_at, completed_at, duration_ms,
    tokens_input, tokens_output,
    error_message, metadata
  )
  VALUES (
    p_trigger_definition_id, p_user_id, p_source_record_id, p_source_data,
    p_status, p_ai_run_id, p_output_text, p_output_data,
    p_action_taken, p_action_result,
    p_started_at, p_completed_at, p_duration_ms,
    p_tokens_input, p_tokens_output,
    p_error_message, p_metadata
  )
  RETURNING ai_proactive_runs.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION save_proactive_run(uuid, uuid, uuid, jsonb, text, uuid, text, jsonb, text, jsonb, timestamptz, timestamptz, integer, integer, integer, text, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION save_proactive_run(uuid, uuid, uuid, jsonb, text, uuid, text, jsonb, text, jsonb, timestamptz, timestamptz, integer, integer, integer, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION save_proactive_run(uuid, uuid, uuid, jsonb, text, uuid, text, jsonb, text, jsonb, timestamptz, timestamptz, integer, integer, integer, text, jsonb) TO service_role;
