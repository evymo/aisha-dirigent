CREATE OR REPLACE FUNCTION public.get_intranet_messages(
  p_channel_slug text,
  p_limit int DEFAULT 50,
  p_before timestamptz DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id uuid,
  user_email text,
  content text,
  metadata jsonb,
  is_edited boolean,
  created_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_channel_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT c.id INTO v_channel_id
  FROM intranet_chat_channels c
  JOIN intranet_chat_members m ON m.channel_id = c.id AND m.user_id = v_caller
  WHERE c.slug = p_channel_slug AND NOT c.is_archived;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'channel_not_found_or_not_member';
  END IF;

  RETURN QUERY
  SELECT
    msg.id,
    msg.user_id,
    u.email AS user_email,
    msg.content,
    msg.metadata,
    msg.is_edited,
    msg.created_at
  FROM intranet_chat_messages msg
  JOIN auth.users u ON u.id = msg.user_id
  WHERE msg.channel_id = v_channel_id
    AND (p_before IS NULL OR msg.created_at < p_before)
  ORDER BY msg.created_at DESC
  LIMIT LEAST(p_limit, 200);
END;
$$;

REVOKE ALL ON FUNCTION get_intranet_messages(text, int, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_intranet_messages(text, int, timestamptz) TO authenticated;
