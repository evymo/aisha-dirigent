CREATE OR REPLACE FUNCTION get_active_triggers_for_source(
  p_source_table text,
  p_source_event text DEFAULT 'INSERT'
)
RETURNS TABLE (
  id uuid,
  name text,
  condition jsonb,
  action_type text,
  agent_name text,
  workflow_name text,
  action_config jsonb,
  target_roles text[],
  priority text,
  cooldown_minutes integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := public.is_service_role();
  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  RETURN QUERY
    SELECT
      t.id, t.name, t.condition, t.action_type,
      t.agent_name, t.workflow_name, t.action_config,
      t.target_roles, t.priority, t.cooldown_minutes
    FROM ai_proactive_trigger_definitions t
    WHERE t.source_table = p_source_table
      AND t.source_event = p_source_event
      AND t.is_active = true
    ORDER BY
      CASE t.priority
        WHEN 'critical' THEN 0
        WHEN 'high' THEN 1
        WHEN 'normal' THEN 2
        WHEN 'low' THEN 3
      END;
END;
$$;

REVOKE ALL ON FUNCTION get_active_triggers_for_source(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_triggers_for_source(text, text) TO authenticated;
