-- Function: public.terminate_other_sessions
-- Arguments: p_current_session_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:10+01:00

CREATE OR REPLACE FUNCTION public.terminate_other_sessions(p_current_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM user_sessions 
  WHERE user_id = auth.uid() 
    AND id != p_current_session_id;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.terminate_other_sessions(p_current_session_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.terminate_other_sessions(p_current_session_id uuid) TO authenticated;
