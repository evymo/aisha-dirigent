-- Function: public.adopt_story_as_stack_default
-- Arguments: p_story_id uuid, p_demote_existing boolean DEFAULT false
-- Description: Marks a story as THE stack-default story (singleton enforced by
--              partial unique index uniq_partner_stories_stack_default).
--              Idempotent when the story is already the default. If another
--              story currently holds the flag, it is demoted first when
--              p_demote_existing = true; otherwise the call fails.
--              Typical use: a replica instance adopts the bootstrapped story
--              as the story that owns its public default web.
-- Security: SECURITY INVOKER + explicit role check (service_role or admin/staff)
--           per ensure_stack_default_story — admin RLS policy on partner_stories
--           permits the UPDATEs, service_role bypasses RLS.

CREATE OR REPLACE FUNCTION public.adopt_story_as_stack_default(
  p_story_id uuid,
  p_demote_existing boolean DEFAULT false
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_is_service boolean;
  v_story record;
  v_current_default_id uuid;
BEGIN
  v_is_service := public.is_service_role();
  IF NOT v_is_service AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin/staff or service_role required' USING ERRCODE = '22023';
  END IF;

  SELECT id, is_stack_default INTO v_story
  FROM public.partner_stories
  WHERE id = p_story_id;

  IF v_story.id IS NULL THEN
    RAISE EXCEPTION 'Story not found: %', p_story_id USING ERRCODE = '22023';
  END IF;

  -- Idempotent: already the stack default
  IF v_story.is_stack_default THEN
    RETURN v_story.id;
  END IF;

  SELECT id INTO v_current_default_id
  FROM public.partner_stories
  WHERE is_stack_default = true
    AND id != p_story_id
  LIMIT 1;

  IF v_current_default_id IS NOT NULL THEN
    IF NOT p_demote_existing THEN
      RAISE EXCEPTION 'Another story is already the stack default: %. Pass p_demote_existing = true to replace it.',
        v_current_default_id USING ERRCODE = '22023';
    END IF;

    -- Demote BEFORE adopting — the partial unique index allows only one default
    UPDATE public.partner_stories
    SET is_stack_default = false,
        updated_at = now()
    WHERE id = v_current_default_id;

    INSERT INTO public.audit_journal (user_id, action, metadata)
    VALUES (auth.uid(), 'STACK_DEFAULT_STORY_DEMOTED', jsonb_build_object(
      'area', 'story_sync',
      'severity', 'info',
      'entity_type', 'partner_story',
      'entity_id', v_current_default_id,
      'replaced_by', p_story_id
    ));
  END IF;

  UPDATE public.partner_stories
  SET is_stack_default = true,
      updated_at = now()
  WHERE id = p_story_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (auth.uid(), 'STACK_DEFAULT_STORY_ADOPTED', jsonb_build_object(
    'area', 'story_sync',
    'severity', 'info',
    'entity_type', 'partner_story',
    'entity_id', p_story_id,
    'demoted_previous', v_current_default_id
  ));

  RETURN p_story_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.adopt_story_as_stack_default(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adopt_story_as_stack_default(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.adopt_story_as_stack_default(uuid, boolean) TO service_role;
