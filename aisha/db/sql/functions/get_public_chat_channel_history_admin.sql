-- Function: public.get_public_chat_channel_history_admin
-- Arguments: p_channel_id uuid
-- Description: List configuration history for a channel (admin panel)
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: supabase/migrations/20260410150000_public_chat_channels.sql

CREATE OR REPLACE FUNCTION public.get_public_chat_channel_history_admin(
  p_channel_id uuid
)
RETURNS SETOF public_chat_channel_history
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501'; -- insufficient_privilege
  END IF;
  RETURN QUERY SELECT
    id, channel_id, version, configuration_snapshot,
    change_summary, changed_by, changed_at
  FROM public.public_chat_channel_history
  WHERE channel_id = p_channel_id
  ORDER BY version DESC
  LIMIT 50;
END;
$$;

-- Admin function — body asserts is_admin_or_staff(). Anon never satisfies
-- that check, so the unconditional GRANT TO anon was defense-in-depth dead
-- weight that masked the intent. Authenticated-only matches the admin flow
-- (admin/staff roles assigned via JWT after Keycloak login).
REVOKE ALL ON FUNCTION public.get_public_chat_channel_history_admin(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_chat_channel_history_admin(uuid) TO authenticated;
