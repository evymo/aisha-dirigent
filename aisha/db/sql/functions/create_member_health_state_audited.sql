-- Function: create_member_health_state_audited
-- Creates a new health state for tracking
-- Security: DEFINER with audit trail
-- Created: 2026-01-17

CREATE OR REPLACE FUNCTION public.create_member_health_state_audited(
  p_name_key text,
  p_custom_name text DEFAULT NULL,
  p_severity_scale integer DEFAULT 5,
  p_icon text DEFAULT NULL,
  p_color text DEFAULT NULL,
  p_show_on_dashboard boolean DEFAULT true
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
  INSERT INTO member_health_states (
    user_id, name_key, custom_name, severity_scale, icon, color, show_on_dashboard
  ) VALUES (
    auth.uid(), p_name_key, p_custom_name, p_severity_scale, 
    COALESCE(p_icon, '❓'), COALESCE(p_color, '#6366f1'), p_show_on_dashboard
  )
  RETURNING id INTO v_id;

  INSERT INTO audit_journal (user_id, action_type, entity_type, entity_id, area, severity, summary)
  VALUES (auth.uid(), 'create', 'member_health_state', v_id::text, 'member', 'info', 
          format('Created health state: %s', COALESCE(p_custom_name, p_name_key)));

  RETURN v_id;
END;
$$;

-- Permissions: sensitive data function - authenticated only, no anon access
REVOKE ALL ON FUNCTION public.create_member_health_state_audited(text, text, integer, text, text, boolean) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_member_health_state_audited(text, text, integer, text, text, boolean) TO authenticated;

COMMENT ON FUNCTION public.create_member_health_state_audited(text, text, integer, text, text, boolean) IS 
'Creates a new health state for tracking (e.g., asthma, pain, rash). Audited.';
