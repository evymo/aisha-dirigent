CREATE OR REPLACE FUNCTION get_ai_trigger_admin(p_trigger_id uuid)
RETURNS TABLE (
  id uuid,
  name text,
  display_name text,
  description text,
  source_table text,
  source_event text,
  condition jsonb,
  action_type text,
  agent_name text,
  workflow_name text,
  action_config jsonb,
  target_roles text[],
  priority text,
  is_active boolean,
  cooldown_minutes integer,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  created_by uuid,
  updated_by uuid
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
      t.id, t.name, t.display_name, t.description,
      t.source_table, t.source_event, t.condition,
      t.action_type, t.agent_name, t.workflow_name,
      t.action_config, t.target_roles, t.priority,
      t.is_active, t.cooldown_minutes, t.metadata,
      t.created_at, t.updated_at, t.created_by, t.updated_by
    FROM ai_proactive_trigger_definitions t
    WHERE t.id = p_trigger_id;
END;
$$;

REVOKE ALL ON FUNCTION get_ai_trigger_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ai_trigger_admin(uuid) TO authenticated;
