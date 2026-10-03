-- Function: public.get_public_chat_sessions_admin
-- Arguments: p_channel_id uuid
-- Description: List public chat sessions for a channel (admin panel)
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: supabase/migrations/20260410150000_public_chat_channels.sql

CREATE OR REPLACE FUNCTION public.get_public_chat_sessions_admin(
  p_channel_id uuid
)
RETURNS SETOF public_chat_sessions
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY SELECT
    id, channel_id, visitor_id, status, metadata,
    created_at, updated_at
  FROM public.public_chat_sessions
  WHERE channel_id = p_channel_id
  ORDER BY created_at DESC
  LIMIT 100;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_chat_sessions_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_chat_sessions_admin(uuid) TO authenticated;
