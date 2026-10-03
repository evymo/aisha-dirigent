CREATE OR REPLACE FUNCTION delete_ai_workflow_admin(
  p_workflow_id uuid
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

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_WORKFLOW_DELETE', jsonb_build_object(
    'area', 'admin',
    'severity', 'warning',
    'workflow_id', p_workflow_id
  ));

  DELETE FROM ai_workflow_definitions WHERE id = p_workflow_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION delete_ai_workflow_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_ai_workflow_admin(uuid) TO authenticated;
