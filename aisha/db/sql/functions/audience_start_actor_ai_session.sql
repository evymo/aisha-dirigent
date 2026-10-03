-- Function: audience_start_actor_ai_session

CREATE OR REPLACE FUNCTION public.audience_start_actor_ai_session(p_focus_actor_id uuid, p_mode text DEFAULT 'chat'::text, p_context_profile_slug text DEFAULT 'audience_ai_actor_assistant'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conversation_id UUID;
  v_story_id UUID;
  v_partner_id UUID;
  v_can_access BOOLEAN;
BEGIN
  -- Permission check
  v_can_access := public.audience_user_can_access_via_profile(p_context_profile_slug, p_focus_actor_id);
  IF NOT v_can_access THEN
    RAISE EXCEPTION 'Access denied: caller cannot use context profile % for actor %', p_context_profile_slug, p_focus_actor_id;
  END IF;

  -- story_ai_sessions.story_id is NOT NULL → a partner_story is required, which
  -- in turn requires partner_id. Deep AI relationship sessions therefore apply
  -- only to partner-tier (managed) contacts. Fail clearly otherwise.
  SELECT id INTO v_partner_id FROM public.partner_profiles WHERE user_id = p_focus_actor_id LIMIT 1;
  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Actor % is not a managed partner contact (no partner_profiles row); actor AI sessions require a partner-tier contact', p_focus_actor_id;
  END IF;

  -- Create chat conversation
  INSERT INTO public.chat_conversations (user_id, title, status)
  VALUES (auth.uid(),
          'AI: ' || COALESCE((SELECT display_name FROM public.profiles WHERE user_id = p_focus_actor_id), p_focus_actor_id::text),
          'active')
  RETURNING id INTO v_conversation_id;

  -- Find or create partner_story for the focus actor (partner_id NOT NULL)
  SELECT id INTO v_story_id FROM public.partner_stories WHERE user_id = p_focus_actor_id LIMIT 1;
  IF v_story_id IS NULL THEN
    INSERT INTO public.partner_stories (partner_id, user_id, title, last_activity_at, created_at)
    VALUES (v_partner_id, p_focus_actor_id,
            'Audience relationship — ' || COALESCE((SELECT display_name FROM public.profiles WHERE user_id = p_focus_actor_id), p_focus_actor_id::text),
            now(), now())
    RETURNING id INTO v_story_id;
  END IF;

  -- Create story_ai_sessions row with focus_actor_id
  INSERT INTO public.story_ai_sessions (
    story_id,
    conversation_id,
    session_type,
    focus_actor_id,
    context_snapshot
  ) VALUES (
    v_story_id,
    v_conversation_id,
    p_mode,
    p_focus_actor_id,
    jsonb_build_object(
      'context_profile_slug', p_context_profile_slug,
      'started_at', now(),
      'started_by', auth.uid()
    )
  );

  -- Audit log
  PERFORM public.audience_log_event(
    'create',
    'start_actor_ai_session',
    'chat_conversation',
    v_conversation_id,
    'Started AI session about actor',
    jsonb_build_object('focus_actor_id', p_focus_actor_id, 'mode', p_mode)
  );

  RETURN v_conversation_id;
END;
$function$

;

REVOKE ALL ON FUNCTION audience_start_actor_ai_session(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audience_start_actor_ai_session(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION audience_start_actor_ai_session(uuid,text,text) TO authenticator;
GRANT EXECUTE ON FUNCTION audience_start_actor_ai_session(uuid,text,text) TO service_role;
