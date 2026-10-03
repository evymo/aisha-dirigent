-- Function: public.get_session_memory
-- Arguments: p_conversation_id uuid
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.get_session_memory(p_conversation_id uuid)
 RETURNS TABLE(key text, value jsonb, expires_at timestamptz, updated_at timestamptz)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT sm.key, sm.value, sm.expires_at, sm.updated_at
  FROM ai_session_memory sm
  WHERE sm.conversation_id = p_conversation_id
    AND sm.user_id = auth.uid()
    AND (sm.expires_at IS NULL OR sm.expires_at > now())
  ORDER BY sm.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_session_memory(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_session_memory(uuid) TO authenticated;
