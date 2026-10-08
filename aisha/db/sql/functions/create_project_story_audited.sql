-- Function: public.create_project_story_audited
-- Purpose: Create a caller-owned work project, outside the study/consent workflow.
-- Security: SECURITY DEFINER; caller identity only; authenticated grant; audited.
CREATE OR REPLACE FUNCTION public.create_project_story_audited(
  p_title text,
  p_summary text DEFAULT '',
  p_goals text[] DEFAULT '{}',
  p_constraints text[] DEFAULT '{}'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_caller uuid := auth.uid();
  v_story uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;
  IF p_title IS NULL OR length(trim(p_title)) NOT BETWEEN 1 AND 200
    OR p_summary IS NULL OR length(p_summary) > 8000
    OR p_goals IS NULL OR p_constraints IS NULL
    OR COALESCE(array_ndims(p_goals), 1) > 1 OR COALESCE(array_ndims(p_constraints), 1) > 1
    OR cardinality(p_goals) > 50 OR cardinality(p_constraints) > 50
    OR EXISTS (SELECT 1 FROM unnest(p_goals || p_constraints) AS value
      WHERE value IS NULL OR length(trim(value)) NOT BETWEEN 1 AND 1000) THEN
    RAISE EXCEPTION 'Invalid project input' USING ERRCODE = '22023';
  END IF;

  PERFORM public.ensure_current_user();
  INSERT INTO public.partner_stories (user_id, title, status, origin, project_preview)
  VALUES (v_caller, trim(p_title), 'active', 'project', jsonb_build_object(
    'summary', p_summary, 'goals', to_jsonb(p_goals), 'constraints', to_jsonb(p_constraints),
    'success_criteria', '[]'::jsonb, 'meta', '{}'::jsonb
  )) RETURNING id INTO v_story;
  -- The owner can read through the existing participant RLS and write through existing ACLs.
  INSERT INTO public.story_participants (story_id, user_id, role)
  VALUES (v_story, v_caller, 'owner');

  PERFORM public.write_audit_journal(
    p_action_type := 'create', p_area := 'system',
    p_details := jsonb_build_object('story_id', v_story, 'owner_id', v_caller),
    p_entity_type := 'partner_stories', p_severity := 'notice',
    p_summary := 'User created work project', p_tags := ARRAY['project', 'story', 'create'], p_user_id := v_caller
  );
  RETURN v_story;
END;
$function$;
REVOKE ALL ON FUNCTION public.create_project_story_audited(text, text, text[], text[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_project_story_audited(text, text, text[], text[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_project_story_audited(text, text, text[], text[]) TO authenticated;
