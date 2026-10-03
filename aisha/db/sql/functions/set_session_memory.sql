-- Function: public.set_session_memory
-- Arguments: p_conversation_id uuid, p_key text, p_value jsonb, p_expires_at timestamptz DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.set_session_memory(p_conversation_id uuid, p_key text, p_value jsonb, p_expires_at timestamptz DEFAULT NULL)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  INSERT INTO ai_session_memory (conversation_id, user_id, key, value, expires_at)
  VALUES (p_conversation_id, auth.uid(), p_key, p_value, p_expires_at)
  ON CONFLICT (conversation_id, key)
  DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_session_memory(uuid, text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_session_memory(uuid, text, jsonb, timestamptz) TO authenticated;
