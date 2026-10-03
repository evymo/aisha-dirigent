-- Function: update_member_widget_position_audited
-- Updates dashboard widget position
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.update_member_widget_position_audited(
  p_widget_id uuid,
  p_position jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  UPDATE member_dashboard_widgets 
  SET position = p_position, updated_at = now()
  WHERE id = p_widget_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'update', 'member_dashboard_widget', p_widget_id::text, 'member', 'info', 
          'Updated widget position');

  RETURN true;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.update_member_widget_position_audited(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_member_widget_position_audited(uuid, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_member_widget_position_audited(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.update_member_widget_position_audited(uuid, jsonb) IS 
'Updates dashboard widget position. Audited.';
