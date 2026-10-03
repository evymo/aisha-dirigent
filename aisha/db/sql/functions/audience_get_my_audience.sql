-- Function: audience_get_my_audience

CREATE OR REPLACE FUNCTION public.audience_get_my_audience()
 RETURNS TABLE(audience_size integer, audience_growth_30d numeric, unique_attendees_30d integer, total_attendance_30d integer, events_created_30d integer, events_created_90d integer, last_active_at timestamp with time zone, computed_at timestamp with time zone, source_slug text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    audience_size, audience_growth_30d,
    unique_attendees_30d, total_attendance_30d,
    events_created_30d, events_created_90d,
    last_active_at, computed_at,
    source_slug
  FROM public.audience_actor_aggregate_latest_v
  WHERE user_id = auth.uid();
$function$

;

REVOKE ALL ON FUNCTION audience_get_my_audience() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_get_my_audience() TO authenticated;
GRANT EXECUTE ON FUNCTION audience_get_my_audience() TO authenticator;
GRANT EXECUTE ON FUNCTION audience_get_my_audience() TO service_role;
