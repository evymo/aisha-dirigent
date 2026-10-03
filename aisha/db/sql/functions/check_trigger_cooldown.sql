CREATE OR REPLACE FUNCTION check_trigger_cooldown(
  p_trigger_definition_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cooldown_minutes integer;
  v_last_run timestamptz;
  v_is_service_role BOOLEAN;
BEGIN
  v_is_service_role := public.is_service_role();
  IF auth.uid() IS NULL AND NOT v_is_service_role THEN
    RAISE EXCEPTION 'Access denied: authentication required';
  END IF;

  SELECT t.cooldown_minutes INTO v_cooldown_minutes
  FROM ai_proactive_trigger_definitions t
  WHERE t.id = p_trigger_definition_id;

  IF v_cooldown_minutes IS NULL THEN
    RETURN true; -- trigger not found, allow (will fail later)
  END IF;

  SELECT MAX(r.created_at) INTO v_last_run
  FROM ai_proactive_runs r
  WHERE r.trigger_definition_id = p_trigger_definition_id
    AND r.user_id = p_user_id
    AND r.status IN ('completed', 'running');

  IF v_last_run IS NULL THEN
    RETURN true; -- never triggered, allow
  END IF;

  RETURN (now() - v_last_run) > (v_cooldown_minutes || ' minutes')::interval;
END;
$$;

REVOKE ALL ON FUNCTION check_trigger_cooldown(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_trigger_cooldown(uuid, uuid) TO authenticated;
