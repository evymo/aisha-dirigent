-- Function: public.trigger_update_streak_on_reminder_completion
-- Arguments: (none)
-- Description: Trigger function to update user streak when reminder is completed.
-- Security: SECURITY DEFINER - runs with owner privileges.

CREATE OR REPLACE FUNCTION public.trigger_update_streak_on_reminder_completion()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM update_user_streak(NEW.user_id);
  RETURN NEW;
END;
$function$
;

-- Trigger function: REVOKE to prevent direct invocation
REVOKE ALL ON FUNCTION public.trigger_update_streak_on_reminder_completion() FROM PUBLIC;
