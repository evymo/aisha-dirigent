-- Function: public.get_my_chat_conversations
-- Arguments: p_limit integer, p_status text
-- Description: Get user's chat conversations
-- @security: authenticated
-- @audit: required
-- @phi: true

CREATE OR REPLACE FUNCTION public.get_my_chat_conversations(p_limit integer DEFAULT 50, p_status text DEFAULT 'active'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id UUID;
  v_result JSONB;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Audit sensitive data access
  PERFORM public.write_audit_journal(
      p_action_type := 'view',
      p_area := 'chat',
      p_details := jsonb_build_object('limit', p_limit, 'status', p_status),
      p_entity_id := NULL,
      p_entity_type := 'chat_conversations',
      p_new_values := NULL,
      p_old_values := NULL,
      p_severity := 'notice',
      p_summary := 'Member viewed chat conversations',
      p_tags := ARRAY['phi','member','chat'],
      p_user_id := v_user_id
  );
  
  SELECT jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'title', COALESCE(c.title, ''),
      'status', c.status,
      'message_count', c.message_count,
      'created_at', c.created_at,
      'last_message_at', c.last_message_at
    ) ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
  )
  INTO v_result
  FROM public.chat_conversations c
  WHERE c.user_id = v_user_id
  AND c.status = p_status
  LIMIT p_limit;
  
  RETURN COALESCE(v_result, '[]'::JSONB);
END;
$function$
;

-- Permissions
REVOKE ALL ON FUNCTION public.get_my_chat_conversations(p_limit integer, p_status text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_my_chat_conversations(p_limit integer, p_status text) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_chat_conversations(p_limit integer, p_status text) TO authenticated;
