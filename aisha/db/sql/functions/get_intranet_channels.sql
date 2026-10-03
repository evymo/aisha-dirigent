CREATE OR REPLACE FUNCTION public.get_intranet_channels()
RETURNS TABLE (
  id uuid,
  slug text,
  display_name text,
  channel_type text,
  description text,
  is_default boolean,
  member_count bigint,
  last_message_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  RETURN QUERY
  SELECT
    c.id,
    c.slug,
    c.display_name,
    c.channel_type,
    c.description,
    c.is_default,
    (SELECT count(*) FROM intranet_chat_members m2 WHERE m2.channel_id = c.id) AS member_count,
    (SELECT max(msg.created_at) FROM intranet_chat_messages msg WHERE msg.channel_id = c.id) AS last_message_at
  FROM intranet_chat_channels c
  JOIN intranet_chat_members m ON m.channel_id = c.id AND m.user_id = v_caller
  WHERE NOT c.is_archived
  ORDER BY last_message_at DESC NULLS LAST, c.display_name;
END;
$$;

REVOKE ALL ON FUNCTION get_intranet_channels() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_intranet_channels() TO authenticated;
