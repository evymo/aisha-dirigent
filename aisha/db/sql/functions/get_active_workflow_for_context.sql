CREATE OR REPLACE FUNCTION get_active_workflow_for_context(
  p_context text DEFAULT 'chat'
)
RETURNS TABLE (
  id uuid,
  name text,
  display_name text,
  graph jsonb,
  context text,
  version integer
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
      wd.id,
      wd.name,
      wd.display_name,
      wd.graph,
      wd.context,
      wd.version
    FROM ai_workflow_definitions wd
    WHERE wd.context = p_context
      AND wd.is_active = true
    LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION get_active_workflow_for_context(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_active_workflow_for_context(text) TO authenticated;
