CREATE OR REPLACE FUNCTION delete_ai_trigger_admin(p_trigger_id uuid)
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

  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'AI_TRIGGER_DELETE', jsonb_build_object(
    'area', 'admin', 'severity', 'warning',
    'trigger_id', p_trigger_id
  ));

  DELETE FROM ai_proactive_trigger_definitions WHERE id = p_trigger_id;
END;
$$;

REVOKE ALL ON FUNCTION delete_ai_trigger_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_ai_trigger_admin(uuid) TO authenticated;
