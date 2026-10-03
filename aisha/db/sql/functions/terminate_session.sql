-- Function: public.terminate_session
-- Arguments: p_session_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:11+01:00

CREATE OR REPLACE FUNCTION public.terminate_session(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM user_sessions WHERE id = p_session_id AND user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.terminate_session(p_session_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminate_session(p_session_id uuid) TO authenticated;
