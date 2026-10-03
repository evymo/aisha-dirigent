-- Function: public.create_chat_conversation_audited
-- Arguments: p_title text
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:26:01+01:00

CREATE OR REPLACE FUNCTION public.create_chat_conversation_audited(p_title text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_can_chat BOOLEAN;
  v_conversation_id UUID;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check if user can chat
  v_can_chat := public.user_can_chat(v_user_id);
  IF NOT v_can_chat THEN
    RAISE EXCEPTION 'User not authorized to chat';
  END IF;
  
  -- Create conversation
  INSERT INTO public.chat_conversations (user_id, title, status)
  VALUES (v_user_id, COALESCE(p_title, 'New conversation'), 'active')
  RETURNING id INTO v_conversation_id;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'chat'::journal_area,
      p_entity_id := v_conversation_id::TEXT,
      p_entity_type := 'chat_conversation',
      p_severity := 'info'::journal_severity,
      p_summary := 'User created new chat conversation',
    p_user_id := v_user_id
  );
  
  RETURN jsonb_build_object(
    'conversation_id', v_conversation_id,
    'created_at', now()
  );
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.create_chat_conversation_audited(p_title text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_chat_conversation_audited(p_title text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_chat_conversation_audited(p_title text) TO authenticated;
