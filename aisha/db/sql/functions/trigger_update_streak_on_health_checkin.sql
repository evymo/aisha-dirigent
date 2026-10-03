-- Function: public.trigger_update_streak_on_health_checkin
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:13+01:00

CREATE OR REPLACE FUNCTION public.trigger_update_streak_on_health_checkin()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  PERFORM update_user_streak(NEW.user_id);
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.trigger_update_streak_on_health_checkin() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trigger_update_streak_on_health_checkin() FROM anon;
GRANT EXECUTE ON FUNCTION public.trigger_update_streak_on_health_checkin() TO authenticated;
