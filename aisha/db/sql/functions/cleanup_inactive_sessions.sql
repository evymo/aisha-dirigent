-- Function: public.cleanup_inactive_sessions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:59+01:00

CREATE OR REPLACE FUNCTION public.cleanup_inactive_sessions()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Cleanup sessions older than 30 days
  DELETE FROM public.user_sessions 
  WHERE last_activity < NOW() - INTERVAL '30 days';
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.cleanup_inactive_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_inactive_sessions() TO authenticated;
