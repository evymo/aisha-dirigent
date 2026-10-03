CREATE OR REPLACE FUNCTION set_ai_run_workflow(
  p_run_id uuid,
  p_workflow_definition_id uuid
)
RETURNS void
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

  UPDATE ai_runs
  SET workflow_definition_id = p_workflow_definition_id
  WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION set_ai_run_workflow(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_ai_run_workflow(uuid, uuid) TO authenticated;
