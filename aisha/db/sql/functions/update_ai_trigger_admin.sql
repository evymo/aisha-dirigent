CREATE OR REPLACE FUNCTION update_ai_trigger_admin(
  p_trigger_id uuid,
  p_display_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_condition jsonb DEFAULT NULL,
  p_action_type text DEFAULT NULL,
  p_agent_name text DEFAULT NULL,
  p_workflow_name text DEFAULT NULL,
  p_action_config jsonb DEFAULT NULL,
  p_target_roles text[] DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_cooldown_minutes integer DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS void
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

  UPDATE ai_proactive_trigger_definitions SET
    display_name = COALESCE(p_display_name, display_name),
    description = COALESCE(p_description, description),
    condition = COALESCE(p_condition, condition),
    action_type = COALESCE(p_action_type, action_type),
    agent_name = COALESCE(p_agent_name, agent_name),
    workflow_name = COALESCE(p_workflow_name, workflow_name),
    action_config = COALESCE(p_action_config, action_config),
    target_roles = COALESCE(p_target_roles, target_roles),
    priority = COALESCE(p_priority, priority),
    is_active = COALESCE(p_is_active, is_active),
    cooldown_minutes = COALESCE(p_cooldown_minutes, cooldown_minutes),
    metadata = COALESCE(p_metadata, metadata),
    updated_by = auth.uid()
  WHERE id = p_trigger_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_TRIGGER_UPDATE', jsonb_build_object(
    'area', 'admin', 'severity', 'info',
    'trigger_id', p_trigger_id
  ));
END;
$$;

REVOKE ALL ON FUNCTION update_ai_trigger_admin(uuid, text, text, jsonb, text, text, text, jsonb, text[], text, boolean, integer, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_ai_trigger_admin(uuid, text, text, jsonb, text, text, text, jsonb, text[], text, boolean, integer, jsonb) TO authenticated;
