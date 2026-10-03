CREATE OR REPLACE FUNCTION public.send_intranet_message(
  p_channel_slug text,
  p_content text
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_channel_id uuid;
  v_message_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  IF p_content IS NULL OR length(trim(p_content)) = 0 THEN
    RAISE EXCEPTION 'empty_message';
  END IF;

  SELECT c.id INTO v_channel_id
  FROM intranet_chat_channels c
  JOIN intranet_chat_members m ON m.channel_id = c.id AND m.user_id = v_caller
  WHERE c.slug = p_channel_slug AND NOT c.is_archived;

  IF v_channel_id IS NULL THEN
    RAISE EXCEPTION 'channel_not_found_or_not_member';
  END IF;

  INSERT INTO intranet_chat_messages (channel_id, user_id, content)
  VALUES (v_channel_id, v_caller, trim(p_content))
  RETURNING id INTO v_message_id;

  RETURN v_message_id;
END;
$$;

REVOKE ALL ON FUNCTION send_intranet_message(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION send_intranet_message(text, text) TO authenticated;
