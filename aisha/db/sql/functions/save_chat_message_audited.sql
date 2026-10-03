-- Function: public.save_chat_message_audited
-- Arguments: p_content text, p_conversation_id uuid, p_content_metadata jsonb, p_model_used text, p_response_time_ms integer, p_role text, p_routed_to_agent_id uuid, p_routing_category text, p_tokens_input integer, p_tokens_output integer, p_user_id uuid
-- Description: Saves a chat message with audit logging and content_metadata for Aisha Realtime observability. Supports both authenticated users and service role.
-- Security: SECURITY DEFINER

CREATE OR REPLACE FUNCTION public.save_chat_message_audited(
  p_content text,
  p_conversation_id uuid,
  p_content_metadata jsonb DEFAULT '{}'::jsonb,
  p_model_used text DEFAULT NULL::text,
  p_response_time_ms integer DEFAULT NULL::integer,
  p_role text DEFAULT 'user'::text,
  p_routed_to_agent_id uuid DEFAULT NULL::uuid,
  p_routing_category text DEFAULT NULL::text,
  p_tokens_input integer DEFAULT NULL::integer,
  p_tokens_output integer DEFAULT NULL::integer,
  p_user_id uuid DEFAULT NULL::uuid
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_caller_id UUID;
  v_effective_user_id UUID;
  v_is_service_role BOOLEAN;
  v_is_owner BOOLEAN;
  v_message_id UUID;
BEGIN
  v_caller_id := auth.uid();
  
  -- Check if service role or owner
  v_is_service_role := public.is_service_role();
  
  -- Effective user: honor an explicit p_user_id override only for service role;
  -- authenticated callers are pinned to their own id regardless of p_user_id
  v_effective_user_id := CASE WHEN public.is_service_role() THEN p_user_id ELSE auth.uid() END;
  
  IF NOT v_is_service_role THEN
    -- For regular users, verify ownership
    SELECT EXISTS (
      SELECT 1 FROM public.chat_conversations 
      WHERE id = p_conversation_id AND user_id = v_caller_id
    ) INTO v_is_owner;
    
    IF NOT v_is_owner THEN
      RAISE EXCEPTION 'Access denied';
    END IF;
    
    -- Regular users can only save their own messages
    IF p_role <> 'user' THEN
      RAISE EXCEPTION 'Invalid role for user message' USING ERRCODE = '22023';
    END IF;
  END IF;
  
  -- Insert message with content_metadata for Aisha Realtime observability
  INSERT INTO public.chat_messages (
    conversation_id, role, content, content_metadata, routed_to_agent_id, routing_category,
    model_used, tokens_input, tokens_output, response_time_ms
  ) VALUES (
    p_conversation_id, p_role, p_content, COALESCE(p_content_metadata, '{}'::jsonb),
    p_routed_to_agent_id, p_routing_category,
    p_model_used, p_tokens_input, p_tokens_output, p_response_time_ms
  )
  RETURNING id INTO v_message_id;
  
  -- Audit log - always log with effective user
  PERFORM public.write_audit_journal(
      p_action_type := 'create'::journal_action_type,
      p_area := 'chat'::journal_area,
      p_details := jsonb_build_object('role', p_role, 'via_service_role', v_is_service_role),
      p_entity_id := v_message_id::TEXT,
      p_entity_type := 'chat_message',
      p_severity := 'info'::journal_severity,
      p_summary := CASE WHEN p_role = 'user' THEN 'User sent chat message' ELSE 'AI response saved' END,
      p_user_id := v_effective_user_id
  );
  
  RETURN jsonb_build_object(
    'id', v_message_id,
    'created_at', now()
  );
END;
$function$
;

-- Permissions (with p_content_metadata parameter)
REVOKE ALL ON FUNCTION public.save_chat_message_audited(
  p_content text, p_conversation_id uuid, p_content_metadata jsonb, p_model_used text,
  p_response_time_ms integer, p_role text, p_routed_to_agent_id uuid,
  p_routing_category text, p_tokens_input integer, p_tokens_output integer, p_user_id uuid
) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_chat_message_audited(
  p_content text, p_conversation_id uuid, p_content_metadata jsonb, p_model_used text,
  p_response_time_ms integer, p_role text, p_routed_to_agent_id uuid,
  p_routing_category text, p_tokens_input integer, p_tokens_output integer, p_user_id uuid
) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_chat_message_audited(
  p_content text, p_conversation_id uuid, p_content_metadata jsonb, p_model_used text,
  p_response_time_ms integer, p_role text, p_routed_to_agent_id uuid,
  p_routing_category text, p_tokens_input integer, p_tokens_output integer, p_user_id uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_chat_message_audited(
  p_content text, p_conversation_id uuid, p_content_metadata jsonb, p_model_used text,
  p_response_time_ms integer, p_role text, p_routed_to_agent_id uuid,
  p_routing_category text, p_tokens_input integer, p_tokens_output integer, p_user_id uuid
) TO service_role;
