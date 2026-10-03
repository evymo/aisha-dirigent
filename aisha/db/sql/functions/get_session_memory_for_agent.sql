-- Function: public.get_session_memory_for_agent
-- Arguments: p_conversation_id uuid, p_user_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_session_memory_for_agent(p_conversation_id uuid, p_user_id uuid)
 RETURNS TABLE(key text, value jsonb, expires_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
BEGIN
  IF v_actor_id IS NOT NULL AND NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied';
  END IF;

  RETURN QUERY
  SELECT sm.key, sm.value, sm.expires_at
  FROM ai_session_memory sm
  WHERE sm.conversation_id = p_conversation_id
    AND sm.user_id = p_user_id
    AND (sm.expires_at IS NULL OR sm.expires_at > now())
  ORDER BY sm.key;
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_memory_for_agent(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_memory_for_agent(uuid, uuid) TO authenticated;
