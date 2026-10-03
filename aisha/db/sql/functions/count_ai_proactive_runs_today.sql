-- Function: public.count_ai_proactive_runs_today
-- Arguments: (none)
-- Returns: integer — number of proactive runs created today
-- Security: SECURITY DEFINER (service_role only — used by proactive engine stats)
-- Purpose: Count today's proactive runs for dashboard/stats without direct table access

CREATE OR REPLACE FUNCTION public.count_ai_proactive_runs_today()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count integer;
BEGIN
  -- Auth check: service_role only
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Access denied: service_role only';
  END IF;

  SELECT count(*)::integer INTO v_count
  FROM ai_proactive_runs
  WHERE created_at >= (current_date AT TIME ZONE 'UTC');

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.count_ai_proactive_runs_today() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_ai_proactive_runs_today() TO service_role;
