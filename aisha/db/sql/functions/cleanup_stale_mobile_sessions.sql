-- Function: public.cleanup_stale_mobile_sessions
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:59+01:00

CREATE OR REPLACE FUNCTION public.cleanup_stale_mobile_sessions()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM mobile_sessions
  WHERE last_active_at < now() - INTERVAL '30 days';

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.cleanup_stale_mobile_sessions() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cleanup_stale_mobile_sessions() TO authenticated;
