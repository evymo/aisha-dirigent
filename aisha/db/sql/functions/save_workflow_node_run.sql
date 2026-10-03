CREATE OR REPLACE FUNCTION save_workflow_node_run(
  p_run_id uuid,
  p_node_id text,
  p_node_type text,
  p_agent_name text DEFAULT NULL,
  p_status text DEFAULT 'completed',
  p_input_data jsonb DEFAULT NULL,
  p_output_data jsonb DEFAULT NULL,
  p_transition_key text DEFAULT NULL,
  p_started_at timestamptz DEFAULT NULL,
  p_ended_at timestamptz DEFAULT NULL,
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

  INSERT INTO ai_workflow_node_runs (
    run_id, node_id, node_type, agent_name, status,
    input_data, output_data, transition_key,
    started_at, ended_at, duration_ms,
    tokens_input, tokens_output,
    error_message, metadata
  )
  VALUES (
    p_run_id, p_node_id, p_node_type, p_agent_name, p_status,
    p_input_data, p_output_data, p_transition_key,
    p_started_at, p_ended_at, p_duration_ms,
    p_tokens_input, p_tokens_output,
    p_error_message, p_metadata
  )
  RETURNING ai_workflow_node_runs.id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION save_workflow_node_run(uuid, text, text, text, text, jsonb, jsonb, text, timestamptz, timestamptz, integer, integer, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_workflow_node_run(uuid, text, text, text, text, jsonb, jsonb, text, timestamptz, timestamptz, integer, integer, integer, text, jsonb) TO authenticated;
