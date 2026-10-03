-- Function: public.sync_notification_link
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:10+01:00

CREATE OR REPLACE FUNCTION public.sync_notification_link()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.link IS NOT NULL AND NEW.action_url IS NULL THEN
    NEW.action_url := NEW.link;
  ELSIF NEW.action_url IS NOT NULL AND NEW.link IS NULL THEN
    NEW.link := NEW.action_url;
  END IF;
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.sync_notification_link() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_notification_link() FROM anon;
GRANT EXECUTE ON FUNCTION public.sync_notification_link() TO authenticated;
