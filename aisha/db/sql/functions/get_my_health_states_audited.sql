-- Function: get_my_health_states_audited
-- Returns user's health states for tracking
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.get_my_health_states_audited()
RETURNS TABLE (
  color text,
  created_at timestamptz,
  current_severity int,
  custom_name text,
  dashboard_position jsonb,
  icon text,
  id uuid,
  is_active boolean,
  last_logged_at timestamptz,
  name_key text,
  severity_scale int,
  show_on_dashboard boolean,
  updated_at timestamptz,
  user_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET search_path = public
AS $$
BEGIN
  INSERT INTO audit_journal (user_id, action_type, entity_type, area, severity, summary)
  VALUES (auth.uid(), 'read', 'member_health_states', 'member', 'info', 'Member viewed health states');

  RETURN QUERY
  SELECT 
    mhs.color,
    mhs.created_at,
    mhs.current_severity,
    mhs.custom_name,
    mhs.dashboard_position,
    mhs.icon,
    mhs.id,
    mhs.is_active,
    mhs.last_logged_at,
    mhs.name_key,
    mhs.severity_scale,
    mhs.show_on_dashboard,
    mhs.updated_at,
    mhs.user_id
  FROM member_health_states mhs
  WHERE mhs.user_id = auth.uid() AND mhs.is_active = true
  ORDER BY mhs.name_key;
END;
$$;

-- Permissions: sensitive data function - authenticated only, no anon access
REVOKE ALL ON FUNCTION public.get_my_health_states_audited() FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_health_states_audited() TO authenticated;

COMMENT ON FUNCTION public.get_my_health_states_audited() IS 
'Returns active health states defined by the authenticated user. Audited.';
