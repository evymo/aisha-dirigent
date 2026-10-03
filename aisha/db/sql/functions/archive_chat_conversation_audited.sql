-- Function: public.archive_chat_conversation_audited
-- Arguments: p_conversation_id uuid
-- Security: See function definition below.
-- Extracted: 2026-01-08T18:25:52+01:00

CREATE OR REPLACE FUNCTION public.archive_chat_conversation_audited(p_conversation_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_is_owner BOOLEAN;
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
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Archive
  UPDATE public.chat_conversations
  SET status = 'archived', archived_at = now()
  WHERE id = p_conversation_id;
  
  -- Audit log
  PERFORM public.write_audit_journal(
      p_action_type := 'update'::journal_action_type,
      p_area := 'chat'::journal_area,
      p_entity_id := p_conversation_id::TEXT,
      p_entity_type := 'chat_conversation',
      p_severity := 'info'::journal_severity,
      p_summary := 'User archived chat conversation',
    p_user_id := v_user_id
  );
  
  RETURN jsonb_build_object('success', true);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.archive_chat_conversation_audited(p_conversation_id uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.archive_chat_conversation_audited(p_conversation_id uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.archive_chat_conversation_audited(p_conversation_id uuid) TO authenticated;
