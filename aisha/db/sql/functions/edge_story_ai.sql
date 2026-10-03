-- Function: public.edge_story_ai
-- Purpose: Edge-safe story AI session persistence and audit.

CREATE OR REPLACE FUNCTION public.edge_story_ai(
  p_action text,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_caller_id uuid;
  v_user_id uuid;
  v_story_id uuid;
  v_conversation_id uuid;
  v_is_admin_staff boolean := false;
  v_is_service_role boolean := false;
  v_has_story_access boolean := false;
  v_created boolean := false;
BEGIN
  v_caller_id := auth.uid();
  v_is_service_role := COALESCE(
    (current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role',
    false
  );
  v_user_id := NULLIF(p_payload ->> 'user_id', '')::uuid;
  v_story_id := NULLIF(p_payload ->> 'story_id', '')::uuid;

  IF v_user_id IS NULL THEN
    v_user_id := v_caller_id;
  END IF;

  IF NOT v_is_service_role THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION 'Not authenticated';
    END IF;

    IF v_user_id IS DISTINCT FROM v_caller_id THEN
      RAISE EXCEPTION 'Unauthorized: user mismatch';
    END IF;
  END IF;

  IF p_action = 'get_or_create_story_conversation' THEN
    IF v_user_id IS NULL THEN
      RAISE EXCEPTION 'user_id is required';
    END IF;

    IF v_story_id IS NULL THEN
      RAISE EXCEPTION 'story_id is required';
    END IF;

    v_is_admin_staff := public.is_admin_or_staff(v_user_id);

    SELECT EXISTS (
      SELECT 1
      FROM public.partner_stories ps
      LEFT JOIN public.partner_profiles pp ON pp.id = ps.partner_id
      WHERE ps.id = v_story_id
        AND (
          ps.user_id = v_user_id
          OR pp.user_id = v_user_id
          OR v_is_admin_staff
        )
    ) INTO v_has_story_access;

    IF NOT v_has_story_access THEN
      RAISE EXCEPTION 'Unauthorized: Story access denied';
    END IF;

    SELECT sas.conversation_id
    INTO v_conversation_id
    FROM public.story_ai_sessions sas
    JOIN public.chat_conversations cc ON cc.id = sas.conversation_id
    WHERE sas.story_id = v_story_id
      AND sas.conversation_id IS NOT NULL
      AND cc.user_id = v_user_id
      AND cc.status = 'active'
    ORDER BY sas.created_at DESC
    LIMIT 1;

    IF v_conversation_id IS NULL THEN
      SELECT cc.id
      INTO v_conversation_id
      FROM public.chat_conversations cc
      WHERE cc.user_id = v_user_id
        AND cc.status = 'active'
        AND cc.summary = format('story_id:%s', v_story_id::text)
      ORDER BY cc.last_message_at DESC NULLS LAST, cc.created_at DESC
      LIMIT 1;
    END IF;

    IF v_conversation_id IS NULL THEN
      INSERT INTO public.chat_conversations (
        user_id,
        title,
        summary,
        status
      )
      VALUES (
        v_user_id,
        COALESCE(
          NULLIF(p_payload ->> 'title', ''),
          'Story consultation'
        ),
        format('story_id:%s', v_story_id::text),
        'active'
      )
      RETURNING id INTO v_conversation_id;

      v_created := true;
    END IF;

    RETURN jsonb_build_object(
      'conversation_id', v_conversation_id,
      'created', v_created,
      'story_id', v_story_id,
      'user_id', v_user_id
    );
  END IF;

  IF p_action = 'insert_session' THEN
    IF v_story_id IS NULL THEN
      RAISE EXCEPTION 'story_id is required';
    END IF;

    v_conversation_id := NULLIF(p_payload ->> 'conversation_id', '')::uuid;

    IF v_user_id IS NOT NULL THEN
      v_is_admin_staff := public.is_admin_or_staff(v_user_id);

      SELECT EXISTS (
        SELECT 1
        FROM public.partner_stories ps
        LEFT JOIN public.partner_profiles pp ON pp.id = ps.partner_id
        WHERE ps.id = v_story_id
          AND (
            ps.user_id = v_user_id
            OR pp.user_id = v_user_id
            OR v_is_admin_staff
          )
      ) INTO v_has_story_access;

      IF NOT v_has_story_access THEN
        RAISE EXCEPTION 'Unauthorized: Story access denied';
      END IF;
    END IF;

    IF v_conversation_id IS NOT NULL AND v_user_id IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1
        FROM public.chat_conversations cc
        WHERE cc.id = v_conversation_id
          AND cc.user_id = v_user_id
      ) THEN
        RAISE EXCEPTION 'Conversation does not belong to user';
      END IF;
    END IF;

    INSERT INTO public.story_ai_sessions (
      context_snapshot,
      conversation_id,
      session_type,
      story_id,
      tokens_used
    )
    VALUES (
      COALESCE(p_payload -> 'context_snapshot', '{}'::jsonb),
      v_conversation_id,
      COALESCE(NULLIF(p_payload ->> 'session_type', ''), 'consultation'),
      v_story_id,
      COALESCE(NULLIF(p_payload ->> 'tokens_used', '')::integer, 0)
    )
    RETURNING id INTO v_id;

    INSERT INTO public.audit_journal (
      action_type,
      area,
      details,
      entity_id,
      entity_type,
      severity,
      summary,
      user_id
    )
    VALUES (
      'ai_interaction',
      'partner_portal',
      jsonb_build_object(
        'action', NULLIF(p_payload ->> 'action', ''),
        'conversation_id', v_conversation_id,
        'health_data_included', COALESCE((p_payload ->> 'health_data_included')::boolean, false),
        'partner_access_level', NULLIF(p_payload ->> 'partner_access_level', ''),
        'response_time_ms', COALESCE(NULLIF(p_payload ->> 'response_time_ms', '')::integer, 0),
        'story_id', v_story_id,
        'tokens_used', COALESCE(NULLIF(p_payload ->> 'tokens_used', '')::integer, 0)
      ),
      v_id::text,
      'story_ai_session',
      'low',
      COALESCE(NULLIF(p_payload ->> 'summary', ''), 'AI story consultation'),
      v_user_id
    );

    RETURN jsonb_build_object(
      'id', v_id,
      'ok', true,
      'conversation_id', v_conversation_id
    );
  END IF;

  RAISE EXCEPTION 'Unsupported action: %', p_action;
END;
$function$;

REVOKE ALL ON FUNCTION public.edge_story_ai(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.edge_story_ai(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.edge_story_ai(text, jsonb) TO authenticated;
