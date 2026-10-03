-- ensure_stack_default_story
-- Returns the id of the singleton stack-default story, creating it if missing.
-- Stack-default = the story that owns iterations for the public default web
-- ( = "your Aisha stack is online" landing page).
--
-- Logic is identical to any other story: same table, same lifecycle, same
-- chat-driven UI. Only difference: partner_id IS NULL and is_stack_default = true.
-- Singleton enforced by a partial UNIQUE INDEX.

CREATE OR REPLACE FUNCTION public.ensure_stack_default_story()
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_story_id uuid;
  v_is_service boolean;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or service_role required';
  END IF;

  SELECT id INTO v_story_id
  FROM public.partner_stories
  WHERE is_stack_default = true
  LIMIT 1;

  IF v_story_id IS NOT NULL THEN
    RETURN v_story_id;
  END IF;

  INSERT INTO public.partner_stories (
    partner_id, user_id, title, status, priority,
    is_stack_default, origin, project_preview
  ) VALUES (
    NULL, NULL,
    'Stack default web',
    'inbox', 'normal',
    true, 'stack_bootstrap',
    jsonb_build_object(
      'summary', 'Singleton story owning iterations for the public default web page (slug=index).',
      'goals', jsonb_build_array('Surface the seeded hello-stack landing', 'Allow operators to iterate on it like any other story'),
      'constraints', jsonb_build_array('Singleton — only one row with is_stack_default=true exists.'),
      'success_criteria', jsonb_build_array('Default seed applies first artifact to web_pages.slug=index'),
      'meta', jsonb_build_object('owner', 'stack')
    )
  )
  RETURNING id INTO v_story_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'STACK_DEFAULT_STORY_CREATED',
    jsonb_build_object(
      'area', 'content',
      'severity', 'info',
      'entity_type', 'partner_story',
      'entity_id', v_story_id::text,
      'tags', ARRAY['stack', 'story', 'web_artifact', 'bootstrap']
    )
  );

  RETURN v_story_id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_stack_default_story() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_stack_default_story() TO authenticated, service_role;
