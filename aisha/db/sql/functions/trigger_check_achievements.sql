-- Function: public.trigger_check_achievements
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:12+01:00

CREATE OR REPLACE FUNCTION public.trigger_check_achievements()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM check_user_achievements(NEW.user_id);
  RETURN NEW;
END;
$function$
;

-- Trigger function: REVOKE to prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_check_achievements() FROM PUBLIC;
