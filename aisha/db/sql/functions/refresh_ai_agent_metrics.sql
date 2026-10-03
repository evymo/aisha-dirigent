-- Function: public.refresh_ai_agent_metrics
-- Arguments: none
-- Security: SECURITY DEFINER
-- Source: Extracted from local DB (source-of-truth sync)

CREATE OR REPLACE FUNCTION public.refresh_ai_agent_metrics()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Insufficient permissions' USING ERRCODE = '42501';
  END IF;

  REFRESH MATERIALIZED VIEW CONCURRENTLY ai_agent_metrics_hourly;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_ai_agent_metrics() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_ai_agent_metrics() TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_ai_agent_metrics() TO service_role;
