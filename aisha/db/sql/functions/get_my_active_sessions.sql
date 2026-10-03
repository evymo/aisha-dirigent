-- Function: public.get_my_active_sessions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:51+01:00

CREATE OR REPLACE FUNCTION public.get_my_active_sessions()
 RETURNS TABLE(id uuid, user_agent text, ip_address text, last_active_at timestamptz, created_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY SELECT s.id, s.user_agent, s.ip_address, s.last_active_at, s.created_at
  FROM user_sessions s WHERE s.user_id = auth.uid() ORDER BY s.last_active_at DESC;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_active_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_active_sessions() TO authenticated;
