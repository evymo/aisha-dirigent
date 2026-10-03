CREATE OR REPLACE FUNCTION get_proactive_runs_admin(
  p_trigger_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  trigger_definition_id uuid,
  trigger_name text,
  user_id uuid,
  source_record_id uuid,
  status text,
  action_taken text,
  output_text text,
  started_at timestamptz,
  completed_at timestamptz,
  duration_ms integer,
  tokens_input integer,
  tokens_output integer,
  error_message text,
  created_at timestamptz
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
      r.id, r.trigger_definition_id,
      t.name AS trigger_name,
      r.user_id, r.source_record_id,
      r.status, r.action_taken, r.output_text,
      r.started_at, r.completed_at, r.duration_ms,
      r.tokens_input, r.tokens_output,
      r.error_message, r.created_at
    FROM ai_proactive_runs r
    LEFT JOIN ai_proactive_trigger_definitions t ON t.id = r.trigger_definition_id
    WHERE (p_trigger_id IS NULL OR r.trigger_definition_id = p_trigger_id)
      AND (p_user_id IS NULL OR r.user_id = p_user_id)
      AND (p_status IS NULL OR r.status = p_status)
    ORDER BY r.created_at DESC
    LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION get_proactive_runs_admin(uuid, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_proactive_runs_admin(uuid, uuid, text, integer) TO authenticated;
