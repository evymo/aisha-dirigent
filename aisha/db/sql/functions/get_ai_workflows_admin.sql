CREATE OR REPLACE FUNCTION get_ai_workflows_admin()
RETURNS TABLE (
  id uuid,
  name text,
  display_name text,
  description text,
  context text,
  is_active boolean,
  version integer,
  graph jsonb,
  metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied: admin or staff role required';
  END IF;

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_WORKFLOW_LIST', jsonb_build_object(
    'area', 'admin',
    'severity', 'info'
  ));

  RETURN QUERY
    SELECT
      wd.id,
      wd.name,
      wd.display_name,
      wd.description,
      wd.context,
      wd.is_active,
      wd.version,
      wd.graph,
      wd.metadata,
      wd.created_at,
      wd.updated_at
    FROM ai_workflow_definitions wd
    ORDER BY wd.context, wd.is_active DESC, wd.name;
END;
$$;

REVOKE ALL ON FUNCTION get_ai_workflows_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ai_workflows_admin() TO authenticated;
