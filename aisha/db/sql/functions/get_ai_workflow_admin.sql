CREATE OR REPLACE FUNCTION get_ai_workflow_admin(
  p_workflow_id uuid
)
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
      wd.updated_at,
      wd.created_by,
      wd.updated_by
    FROM ai_workflow_definitions wd
    WHERE wd.id = p_workflow_id;
END;
$$;

REVOKE ALL ON FUNCTION get_ai_workflow_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_ai_workflow_admin(uuid) TO authenticated;
