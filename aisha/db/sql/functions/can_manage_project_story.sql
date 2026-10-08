-- Function: public.can_manage_project_story
-- Purpose: Caller-only ownership predicate for work-project onboarding.
-- Security: SECURITY DEFINER; does not disclose other users' participation.
CREATE OR REPLACE FUNCTION public.can_manage_project_story(p_story_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_stories
    WHERE id = p_story_id AND user_id = auth.uid()
      AND origin = 'project' AND partner_id IS NULL AND study_id IS NULL
  );
$function$;
REVOKE ALL ON FUNCTION public.can_manage_project_story(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_project_story(uuid) TO authenticated;
