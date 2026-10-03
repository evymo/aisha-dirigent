-- Function: public.record_public_chat_message
-- Arguments: p_session_id uuid, p_role text, p_content text, p_metadata jsonb
-- Description: Record a message in a public chat session, update session and channel stats
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: supabase/migrations/20260410150000_public_chat_channels.sql

CREATE OR REPLACE FUNCTION public.record_public_chat_message(
  p_session_id uuid,
  p_role       text,
  p_content    text,
  p_metadata   jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_msg_id uuid;
BEGIN
  INSERT INTO public.public_chat_messages (session_id, role, content, metadata)
  VALUES (p_session_id, p_role, p_content, p_metadata)
  RETURNING id INTO v_msg_id;

  -- Update session stats
  UPDATE public.public_chat_sessions SET
    message_count = message_count + 1,
    last_message_at = now(),
    updated_at = now()
  WHERE id = p_session_id;

  -- Update channel stats
  UPDATE public.public_chat_channels SET
    total_messages = total_messages + 1
  WHERE id = (SELECT channel_id FROM public.public_chat_sessions WHERE id = p_session_id);

  RETURN v_msg_id;
END;
$$;

REVOKE ALL ON FUNCTION public.record_public_chat_message(uuid, text, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_public_chat_message(uuid, text, text, jsonb) TO authenticated;
