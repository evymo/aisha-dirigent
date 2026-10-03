-- =============================================================================
-- Function: submit_ai_feedback
-- Purpose: Submit user feedback on an AI response (for ALE training data)
-- Part of: AISHA Learning Engine (ALE) — Phase 1
--
-- Oprava 2026-09-29 (SELF_IMPROVEMENT_LOOP.md §3, K-16) — naměřeno na main 9087ef3df:
--   Funkce byla SECURITY INVOKER, ale chat_messages má jedinou čtecí politiku — pro
--   správce. Běžný uživatel tak neviděl ani VLASTNÍ zprávu: conversation_id zůstal NULL
--   a process_feedback_to_training takovou zpětnou vazbu vždy přeskočila (bez konverzace
--   nenajde otázku). Zpětná vazba uživatelů se tedy NIKDY nestala trénovacím párem.
--   Současně funkce přijala od volajícího libovolné message_id, run_id a trace_event_id
--   — jakmile by dráha začala fungovat, šlo by „opravovat" cizí odpovědi a otrávit data.
--   org_id se navíc bralo z libovolného partnerského profilu (join na roli, ne na profil).
-- Teď (SECURITY DEFINER, stráž uvnitř):
--   * hodnotit smí jen odpověď asistenta ve VLASTNÍ konverzaci; neexistující i cizí
--     zpráva = táž chyba (žádné orákulum);
--   * run_id a trace_event_id se odvozují ze zprávy; od volajícího se přijmou jen tehdy,
--     když běh patří volajícímu (bez zprávy);
--   * org_id jen z vlastního partnerského profilu.
-- Funkce nebyla v heals — běžící DB držela verzi z cold startu.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.submit_ai_feedback(
  p_correction_text text DEFAULT NULL,
  p_domain_tags text[] DEFAULT '{}'::text[],
  p_feedback_category text DEFAULT 'general',
  p_message_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_rating smallint DEFAULT 0,
  p_run_id uuid DEFAULT NULL,
  p_trace_event_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id uuid;
  v_conversation_id uuid;
  v_org_id uuid;
  v_story_id uuid;
  v_run_id uuid;
  v_trace_event_id uuid;
  v_feedback_id uuid;
  v_recent_count integer;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Rate limit: max 30 feedback per hour per user
  SELECT count(*) INTO v_recent_count
  FROM public.ai_feedback
  WHERE user_id = v_user_id
    AND created_at > now() - interval '1 hour';

  IF v_recent_count >= 30 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'rate_limit_exceeded',
      'message', 'Maximum 30 feedback submissions per hour'
    );
  END IF;

  IF p_message_id IS NOT NULL THEN
    -- Jen odpověď asistenta ve vlastní konverzaci. Cizí i neexistující = táž chyba.
    SELECT cm.conversation_id, NULLIF(cm.content_metadata->>'aisha_run_id', '')::uuid
      INTO v_conversation_id, v_run_id
    FROM public.chat_messages cm
    JOIN public.chat_conversations c ON c.id = cm.conversation_id
    WHERE cm.id = p_message_id
      AND cm.role = 'assistant'
      AND c.user_id = v_user_id;

    IF v_conversation_id IS NULL THEN
      RAISE EXCEPTION 'Message not found' USING ERRCODE = 'P0002';
    END IF;
  ELSIF p_run_id IS NOT NULL THEN
    -- Bez zprávy: běh přijmeme jen tehdy, když patří volajícímu.
    SELECT ar.id INTO v_run_id
    FROM public.ai_runs ar
    WHERE ar.id = p_run_id AND ar.actor_user_id = v_user_id;
  END IF;

  IF v_run_id IS NOT NULL THEN
    SELECT ar.story_id INTO v_story_id
    FROM public.ai_runs ar
    WHERE ar.id = v_run_id;

    -- trace_event_id od volajícího jen z téhož běhu; jinak poslední llm_call běhu.
    IF p_trace_event_id IS NOT NULL THEN
      SELECT ate.id INTO v_trace_event_id
      FROM public.ai_trace_events ate
      WHERE ate.id = p_trace_event_id AND ate.run_id = v_run_id;
    END IF;
    IF v_trace_event_id IS NULL THEN
      SELECT ate.id INTO v_trace_event_id
      FROM public.ai_trace_events ate
      WHERE ate.run_id = v_run_id
        AND ate.event_type = 'llm_call'
      ORDER BY ate.created_at DESC
      LIMIT 1;
    END IF;
  END IF;

  -- Organizace jen z vlastního partnerského profilu.
  SELECT pp.id INTO v_org_id
  FROM public.partner_profiles pp
  WHERE pp.user_id = v_user_id
  LIMIT 1;

  INSERT INTO public.ai_feedback (
    trace_event_id,
    conversation_id,
    message_id,
    user_id,
    org_id,
    story_id,
    run_id,
    rating,
    correction_text,
    feedback_category,
    domain_tags,
    metadata
  ) VALUES (
    v_trace_event_id,
    v_conversation_id,
    p_message_id,
    v_user_id,
    v_org_id,
    v_story_id,
    v_run_id,
    p_rating,
    p_correction_text,
    p_feedback_category,
    p_domain_tags,
    p_metadata
  )
  RETURNING id INTO v_feedback_id;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'AI_FEEDBACK_SUBMITTED',
    jsonb_build_object(
      'feedback_id', v_feedback_id,
      'rating', p_rating,
      'category', p_feedback_category,
      'has_correction', p_correction_text IS NOT NULL,
      'has_run_id', v_run_id IS NOT NULL,
      'has_story_id', v_story_id IS NOT NULL
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'feedback_id', v_feedback_id,
    'run_id', v_run_id,
    'story_id', v_story_id,
    'trace_event_id', v_trace_event_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_ai_feedback(text, text[], text, uuid, jsonb, smallint, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_ai_feedback(text, text[], text, uuid, jsonb, smallint, uuid, uuid) TO authenticated;

COMMENT ON FUNCTION public.submit_ai_feedback(text, text[], text, uuid, jsonb, smallint, uuid, uuid) IS
  'Zpětná vazba uživatele na odpověď asistenta ve VLASTNÍ konverzaci (ALE). run/trace se odvozují ze zprávy; '
  'cizí i neexistující zpráva = Message not found. Limit 30/h.';
