-- Function: public.get_chat_messages_audited
-- Arguments: p_conversation_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:42+01:00

CREATE OR REPLACE FUNCTION public.get_chat_messages_audited(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_is_owner BOOLEAN;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check ownership
  SELECT EXISTS (
    SELECT 1 FROM public.chat_conversations 
    WHERE id = p_conversation_id AND user_id = v_user_id
  ) INTO v_is_owner;
  
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Access denied to conversation';
  END IF;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'chat',
      p_details := jsonb_build_object('conversation_id', p_conversation_id),
      p_entity_id := NULL,
      p_entity_type := 'chat_message',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'info',
      p_summary := 'User viewed chat messages',
      p_user_id := NULL
  );

  -- ai_run_id surfaced from existing content_metadata jsonb (Step 2 systemic
  -- follow-up — supports FaithfulnessChip + CitationPanel on history loads).
  -- Primary: content_metadata.run_id (tracer per-call ai_runs.id).
  -- Fallback: content_metadata.aisha_run_id (route plan ai_runs.id).
  -- NULL when neither present — Step 2 UI hides chip/panel gracefully.
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', m.id,
      'role', m.role,
      'content', m.content,
      'routing_category', COALESCE(m.routing_category, ''),
      'created_at', m.created_at,
      'ai_run_id', COALESCE(
        NULLIF(m.content_metadata->>'run_id', ''),
        NULLIF(m.content_metadata->>'aisha_run_id', '')
      )
    ) ORDER BY m.created_at ASC
  )
  INTO v_result
  FROM public.chat_messages m
  WHERE m.conversation_id = p_conversation_id
  AND m.is_visible = true;
  
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_chat_messages_audited(p_conversation_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_chat_messages_audited(p_conversation_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_chat_messages_audited(p_conversation_id uuid) TO authenticated;
