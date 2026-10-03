-- Function: audience_story_labels_validate_resource

CREATE OR REPLACE FUNCTION public.audience_story_labels_validate_resource()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_exists BOOLEAN;
BEGIN
  IF NEW.resource_id IS NULL THEN
    RETURN NEW;  -- legacy story-only rows (story_id FK covers them)
  END IF;

  CASE NEW.resource_type
    WHEN 'actor' THEN
      SELECT EXISTS(SELECT 1 FROM aisha_auth.users u WHERE u.id = NEW.resource_id) INTO v_exists;
    WHEN 'story' THEN
      SELECT EXISTS(SELECT 1 FROM public.partner_stories s WHERE s.id = NEW.resource_id) INTO v_exists;
    WHEN 'campaign' THEN
      SELECT EXISTS(SELECT 1 FROM public.notification_campaigns c WHERE c.id = NEW.resource_id) INTO v_exists;
    WHEN 'cohort' THEN
      SELECT EXISTS(SELECT 1 FROM public.studies st WHERE st.id = NEW.resource_id) INTO v_exists;
    ELSE
      -- Unknown resource_type: allow (forward-compatible). Add a mapping above
      -- when a new resource_type goes into use so it gets validated too.
      RETURN NEW;
  END CASE;

  IF NOT v_exists THEN
    RAISE EXCEPTION 'story_labels: % resource_id % does not exist (referential integrity)',
      NEW.resource_type, NEW.resource_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_story_labels_validate_resource() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_story_labels_validate_resource() TO service_role;
