-- Function: public.trigger_update_streak_on_activity
-- Description: Generic trigger function to update user streak on any activity
-- Security: SECURITY DEFINER - runs with owner privileges
-- Created: 2026-02-03

CREATE OR REPLACE FUNCTION public.trigger_update_streak_on_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Update streak for the user
  PERFORM update_user_streak(NEW.user_id);
  RETURN NEW;
END;
$function$;

-- Permissions
REVOKE ALL ON FUNCTION public.trigger_update_streak_on_activity() FROM PUBLIC;

COMMENT ON FUNCTION trigger_update_streak_on_activity() IS 'Generic trigger function to update user streak on any activity';
