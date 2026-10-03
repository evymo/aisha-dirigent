-- Function: public.get_or_create_public_chat_session
-- Arguments: p_channel_id uuid, p_visitor_id text, p_metadata jsonb
-- Description: Find existing active session or create a new one, return session info with recent messages
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: aisha/db/migrations/20260410150000_public_chat_channels.sql

CREATE OR REPLACE FUNCTION public.get_or_create_public_chat_session(
  p_channel_id  uuid,
  p_visitor_id  text,
  p_metadata    jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_session record;
  v_messages jsonb;
BEGIN
  -- Try to find existing active session
  SELECT
    pcs.id,
    pcs.message_count
  INTO v_session
  FROM public.public_chat_sessions pcs
  WHERE pcs.channel_id = p_channel_id
    AND pcs.visitor_id = p_visitor_id
    AND pcs.status = 'active'
    AND pcs.updated_at > now() - interval '24 hours'
  ORDER BY pcs.created_at DESC
  LIMIT 1;

  IF v_session IS NULL THEN
    -- Create new session
    INSERT INTO public.public_chat_sessions (channel_id, visitor_id, visitor_metadata)
    VALUES (p_channel_id, p_visitor_id, p_metadata)
    RETURNING id, message_count INTO v_session;

    -- Increment channel session count
    UPDATE public.public_chat_channels
    SET total_sessions = total_sessions + 1
    WHERE id = p_channel_id;

    v_messages := '[]'::jsonb;
  ELSE
    -- Load last 20 messages for context
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object('role', m.role, 'content', m.content, 'created_at', m.created_at)
      ORDER BY m.created_at
    ), '[]'::jsonb) INTO v_messages
    FROM (
      SELECT role, content, created_at
      FROM public.public_chat_messages
      WHERE session_id = v_session.id
      ORDER BY created_at DESC
      LIMIT 20
    ) m;
  END IF;

  RETURN jsonb_build_object(
    'session_id', v_session.id,
    'is_new', v_session.message_count = 0,
    'message_count', v_session.message_count,
    'messages', v_messages
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_public_chat_session(uuid, text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_or_create_public_chat_session(uuid, text, jsonb) TO authenticated;
