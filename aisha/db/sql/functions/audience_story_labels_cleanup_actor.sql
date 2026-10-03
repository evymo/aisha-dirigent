-- Function: audience_story_labels_cleanup_actor

CREATE OR REPLACE FUNCTION public.audience_story_labels_cleanup_actor()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.story_labels
  WHERE resource_type = 'actor' AND resource_id = OLD.id;
  RETURN OLD;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_story_labels_cleanup_actor() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_story_labels_cleanup_actor() TO service_role;
