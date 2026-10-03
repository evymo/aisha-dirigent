-- Function: public.set_session_memory_for_agent
-- Arguments: p_conversation_id uuid, p_user_id uuid, p_key text, p_value jsonb, p_expires_at timestamptz DEFAULT NULL
-- Security: SECURITY DEFINER
-- Source: Phase 4 — Agent Loop & Memory

CREATE OR REPLACE FUNCTION public.set_session_memory_for_agent(p_conversation_id uuid, p_user_id uuid, p_key text, p_value jsonb, p_expires_at timestamptz DEFAULT NULL)
 RETURNS void
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

  INSERT INTO ai_session_memory (conversation_id, user_id, key, value, expires_at)
  VALUES (p_conversation_id, p_user_id, p_key, p_value, p_expires_at)
  ON CONFLICT (conversation_id, key)
  DO UPDATE SET value = EXCLUDED.value, expires_at = EXCLUDED.expires_at, updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.set_session_memory_for_agent(uuid, uuid, text, jsonb, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.set_session_memory_for_agent(uuid, uuid, text, jsonb, timestamptz) TO authenticated;
