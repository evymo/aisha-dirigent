-- Join a user to an intranet chat channel.
-- Auth-first COALESCE: auth.uid() (JWT) always wins for authenticated callers.
-- Service_role (auth.uid() IS NULL) falls back to explicit p_user_id.
CREATE OR REPLACE FUNCTION public.join_intranet_channel(
  p_channel_slug text,
  p_user_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := COALESCE(auth.uid(), p_user_id);
  v_channel record;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  SELECT
    icc.id,
    icc.channel_type
  INTO v_channel
  FROM intranet_chat_channels icc
  WHERE icc.slug = p_channel_slug AND NOT icc.is_archived;

  IF v_channel IS NULL THEN
    RAISE EXCEPTION 'channel_not_found';
  END IF;

  -- Only general channels allow self-join; others require admin/staff
  IF v_channel.channel_type != 'general' THEN
    IF NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_caller AND ur.role IN ('admin', 'staff')) THEN
      RAISE EXCEPTION 'channel_requires_invite';
    END IF;
  END IF;

  INSERT INTO intranet_chat_members (channel_id, user_id, role)
  VALUES (v_channel.id, v_caller, 'member')
  ON CONFLICT (channel_id, user_id) DO NOTHING;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION join_intranet_channel(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION join_intranet_channel(text, uuid) TO authenticated, service_role;
