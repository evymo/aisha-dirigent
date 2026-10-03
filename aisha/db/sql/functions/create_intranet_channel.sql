CREATE OR REPLACE FUNCTION public.create_intranet_channel(
  p_slug text,
  p_display_name text,
  p_type text DEFAULT 'general',
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_channel_id uuid;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  -- Only admin/staff can create channels
  IF NOT EXISTS (SELECT 1 FROM user_roles ur WHERE ur.user_id = v_caller AND ur.role IN ('admin', 'staff')) THEN
    RAISE EXCEPTION 'insufficient_permissions';
  END IF;

  INSERT INTO intranet_chat_channels (slug, display_name, channel_type, description, created_by)
  VALUES (p_slug, p_display_name, p_type, p_description, v_caller)
  RETURNING id INTO v_channel_id;

  -- Creator auto-joins as channel admin
  INSERT INTO intranet_chat_members (channel_id, user_id, role)
  VALUES (v_channel_id, v_caller, 'admin');

  RETURN v_channel_id;
END;
$$;

REVOKE ALL ON FUNCTION create_intranet_channel(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_intranet_channel(text, text, text, text) TO authenticated;
