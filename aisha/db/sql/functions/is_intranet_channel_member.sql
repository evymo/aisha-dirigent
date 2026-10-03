-- RLS helper: check if the calling user is a member of a given intranet chat channel.
-- Uses SECURITY DEFINER to bypass RLS on intranet_chat_members, avoiding
-- infinite recursion when this is called from within an RLS policy.
--
-- Auth-first COALESCE pattern: auth.uid() (JWT identity) always wins over
-- p_user_id. Authenticated callers can only check their own membership.
-- Service_role callers (auth.uid() IS NULL) fall back to p_user_id.
CREATE OR REPLACE FUNCTION public.is_intranet_channel_member(
  p_channel_id uuid,
  p_user_id uuid
)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT EXISTS (
    SELECT 1 FROM intranet_chat_members
    WHERE channel_id = p_channel_id AND user_id = COALESCE(auth.uid(), p_user_id)
  );
$$;

REVOKE ALL ON FUNCTION is_intranet_channel_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_intranet_channel_member(uuid, uuid) TO authenticated;
