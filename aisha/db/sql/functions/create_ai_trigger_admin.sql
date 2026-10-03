CREATE OR REPLACE FUNCTION create_ai_trigger_admin(
  p_name text,
  p_display_name text,
  p_source_table text,
  p_source_event text DEFAULT 'INSERT',
  p_condition jsonb DEFAULT '{}'::jsonb,
  p_action_type text DEFAULT 'analyze',
  p_agent_name text DEFAULT NULL,
  p_workflow_name text DEFAULT NULL,
  p_action_config jsonb DEFAULT '{}'::jsonb,
  p_target_roles text[] DEFAULT ARRAY['member']::text[],
  p_priority text DEFAULT 'normal',
  p_is_active boolean DEFAULT false,
  p_cooldown_minutes integer DEFAULT 1440,
  p_description text DEFAULT '',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO ai_proactive_trigger_definitions (
    name, display_name, description, source_table, source_event,
    condition, action_type, agent_name, workflow_name,
    action_config, target_roles, priority, is_active,
    cooldown_minutes, metadata, created_by
  )
  VALUES (
    p_name, p_display_name, p_description, p_source_table, p_source_event,
    p_condition, p_action_type, p_agent_name, p_workflow_name,
    p_action_config, p_target_roles, p_priority, p_is_active,
    p_cooldown_minutes, p_metadata, auth.uid()
  )
  RETURNING ai_proactive_trigger_definitions.id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_TRIGGER_CREATE', jsonb_build_object(
    'area', 'admin', 'severity', 'info',
    'trigger_id', v_id, 'trigger_name', p_name
  ));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_ai_trigger_admin(text, text, text, text, jsonb, text, text, text, jsonb, text[], text, boolean, integer, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_ai_trigger_admin(text, text, text, text, jsonb, text, text, text, jsonb, text[], text, boolean, integer, text, jsonb) TO authenticated;
