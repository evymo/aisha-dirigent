CREATE OR REPLACE FUNCTION create_ai_workflow_admin(
  p_name text,
  p_display_name text,
  p_description text DEFAULT '',
  p_context text DEFAULT 'chat',
  p_graph jsonb DEFAULT '{}'::jsonb,
  p_is_active boolean DEFAULT false,
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

  INSERT INTO ai_workflow_definitions (name, display_name, description, context, graph, is_active, metadata, created_by)
  VALUES (p_name, p_display_name, p_description, p_context, p_graph, p_is_active, p_metadata, auth.uid())
  RETURNING ai_workflow_definitions.id INTO v_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_WORKFLOW_CREATE', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'workflow_id', v_id,
    'workflow_name', p_name
  ));

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION create_ai_workflow_admin(text, text, text, text, jsonb, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_ai_workflow_admin(text, text, text, text, jsonb, boolean, jsonb) TO authenticated;
