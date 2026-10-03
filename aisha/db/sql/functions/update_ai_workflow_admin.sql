CREATE OR REPLACE FUNCTION update_ai_workflow_admin(
  p_workflow_id uuid,
  p_display_name text DEFAULT NULL,
  p_description text DEFAULT NULL,
  p_graph jsonb DEFAULT NULL,
  p_is_active boolean DEFAULT NULL,
  p_metadata jsonb DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  -- If activating this workflow, deactivate others in same context
  IF p_is_active = true THEN
    UPDATE ai_workflow_definitions
    SET is_active = false, updated_by = auth.uid()
    WHERE context = (SELECT wd2.context FROM ai_workflow_definitions wd2 WHERE wd2.id = p_workflow_id)
      AND id != p_workflow_id
      AND is_active = true;
  END IF;

  UPDATE ai_workflow_definitions
  SET
    display_name = COALESCE(p_display_name, display_name),
    description = COALESCE(p_description, description),
    graph = COALESCE(p_graph, graph),
    is_active = COALESCE(p_is_active, is_active),
    metadata = COALESCE(p_metadata, metadata),
    version = CASE WHEN p_graph IS NOT NULL THEN version + 1 ELSE version END,
    updated_by = auth.uid()
  WHERE id = p_workflow_id;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_WORKFLOW_UPDATE', jsonb_build_object(
    'area', 'admin',
    'severity', 'info',
    'workflow_id', p_workflow_id,
    'graph_changed', p_graph IS NOT NULL,
    'activation_changed', p_is_active IS NOT NULL
  ));

  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION update_ai_workflow_admin(uuid, text, text, jsonb, boolean, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION update_ai_workflow_admin(uuid, text, text, jsonb, boolean, jsonb) TO authenticated;
