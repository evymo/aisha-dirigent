-- Function: public.update_story_last_activity
-- Arguments: (none)
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:28:27+01:00

CREATE OR REPLACE FUNCTION public.update_story_last_activity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.partner_stories
  SET 
    last_activity_at = now(),
    updated_at = now(),
    unread_count = CASE 
      WHEN NEW.created_by IS DISTINCT FROM (
        SELECT pp.user_id FROM partner_profiles pp 
        WHERE pp.id = (SELECT partner_id FROM partner_stories WHERE id = NEW.story_id)
      ) THEN unread_count + 1
      ELSE unread_count
    END
  WHERE id = NEW.story_id;
  RETURN NEW;
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.update_story_last_activity() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_story_last_activity() TO authenticated;
