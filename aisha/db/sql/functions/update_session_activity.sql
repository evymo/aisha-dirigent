-- Function: public.update_session_activity
-- Arguments: p_session_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:26+01:00

CREATE OR REPLACE FUNCTION public.update_session_activity(p_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.user_sessions
  SET
    last_activity = now(),
    last_active_at = now()
  WHERE id = p_session_id
    AND user_id = auth.uid();
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_session_activity(p_session_id uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_session_activity(p_session_id uuid) TO authenticated;
