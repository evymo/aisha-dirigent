-- Function: create_member_widget_audited
-- Creates a new dashboard widget
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.create_member_widget_audited(
  p_widget_type text,
  p_reference_id uuid DEFAULT NULL,
  p_position jsonb DEFAULT '{"row": 0, "col": 0}'::jsonb,
  p_settings jsonb DEFAULT '{}'::jsonb,
  p_is_visible boolean DEFAULT true
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO member_dashboard_widgets (user_id, widget_type, reference_id, position, settings, is_visible)
  VALUES (auth.uid(), p_widget_type, p_reference_id, p_position, p_settings, p_is_visible)
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'create', 'member_dashboard_widget', v_id::text, 'member', 'info', 
          format('Created widget: %s', p_widget_type));

  RETURN v_id;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.create_member_widget_audited(text, uuid, jsonb, jsonb, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_member_widget_audited(text, uuid, jsonb, jsonb, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_member_widget_audited(text, uuid, jsonb, jsonb, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_member_widget_audited(text, uuid, jsonb, jsonb, boolean) IS 
'Creates a new dashboard widget. Audited.';
