CREATE OR REPLACE FUNCTION get_workflow_run_nodes_admin(
  p_run_id uuid
)
RETURNS TABLE (
  id uuid,
  node_id text,
  node_type text,
  agent_name text,
  status text,
  transition_key text,
  started_at timestamptz,
  ended_at timestamptz,
  duration_ms integer,
  tokens_input integer,
  tokens_output integer,
  error_message text,
  metadata jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  RETURN QUERY
    SELECT
      nr.id,
      nr.node_id,
      nr.node_type,
      nr.agent_name,
      nr.status,
      nr.transition_key,
      nr.started_at,
      nr.ended_at,
      nr.duration_ms,
      nr.tokens_input,
      nr.tokens_output,
      nr.error_message,
      nr.metadata
    FROM ai_workflow_node_runs nr
    WHERE nr.run_id = p_run_id
    ORDER BY nr.started_at ASC NULLS LAST, nr.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION get_workflow_run_nodes_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_workflow_run_nodes_admin(uuid) TO authenticated;
