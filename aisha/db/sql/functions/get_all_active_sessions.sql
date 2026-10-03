-- Function: public.get_all_active_sessions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:33+01:00

CREATE OR REPLACE FUNCTION public.get_all_active_sessions()
 RETURNS TABLE(id uuid, user_id uuid, user_email text, user_agent text, ip_address text, last_active_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_user_id, 'admin') THEN 
    RAISE EXCEPTION 'Access denied'; 
  END IF;

  -- Audit log for admin accessing sessions
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'admin',
      p_details := NULL,
      p_entity_id := NULL,
      p_entity_type := 'user_sessions',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Admin viewing all active sessions',
      p_tags := ARRAY['phi','admin','sessions'],
      p_user_id := v_user_id
  );

  RETURN QUERY 
  SELECT s.id, s.user_id, p.email as user_email, s.user_agent, s.ip_address, s.last_active_at
  FROM user_sessions s LEFT JOIN profiles p ON p.id = s.user_id ORDER BY s.last_active_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_all_active_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_all_active_sessions() TO authenticated;
