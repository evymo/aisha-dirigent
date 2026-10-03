-- Function: get_member_dashboard_widgets_audited
-- Returns user's dashboard widget configuration
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_member_dashboard_widgets_audited()
RETURNS TABLE (
  created_at timestamptz,
  id uuid,
  is_visible boolean,
  "position" jsonb,
  reference_id uuid,
  settings jsonb,
  updated_at timestamptz,
  user_id uuid,
  widget_type text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (auth.uid(), 'read', 'member_dashboard_widgets', 'member', 'info', 'Member viewed dashboard widgets');

  RETURN QUERY
  SELECT 
    mdw.created_at,
    mdw.id,
    mdw.is_visible,
    mdw.position,
    mdw.reference_id,
    mdw.settings,
    mdw.updated_at,
    mdw.user_id,
    mdw.widget_type
  FROM member_dashboard_widgets mdw
  WHERE mdw.user_id = auth.uid() AND mdw.is_visible = true
  ORDER BY (mdw.position->>'row')::int, (mdw.position->>'col')::int;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION public.get_member_dashboard_widgets_audited() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_member_dashboard_widgets_audited() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_member_dashboard_widgets_audited() TO authenticated;

COMMENT ON FUNCTION public.get_member_dashboard_widgets_audited() IS 
'Returns visible dashboard widgets for the authenticated user. Audited.';
