-- Function: public.audit_journal_set_action
-- Arguments: (none - trigger function)
-- Description: Trigger to set action from action_type if action is 'unknown'.
-- Security: Trigger function - no direct GRANT needed, revoke from anon for security.
-- Created: 2026-02-06

CREATE OR REPLACE FUNCTION public.audit_journal_set_action()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  -- If action is the default 'unknown' but action_type is set, use action_type
  IF NEW.action = 'unknown' AND NEW.action_type IS NOT NULL THEN
    NEW.action := NEW.action_type;
  END IF;
  
  RETURN NEW;
END;
$function$;

-- Permissions - trigger function, revoke from anon
REVOKE ALL ON FUNCTION public.audit_journal_set_action() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.audit_journal_set_action() FROM anon;
