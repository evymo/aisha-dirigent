-- Function: public.get_user_cosmos_address
-- Arguments: p_user_id uuid
-- Description: Retrieves the cosmos address for a user profile.
-- Security: SECURITY DEFINER, service_role only

CREATE OR REPLACE FUNCTION public.get_user_cosmos_address(p_user_id uuid)
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object('cosmos_address', cosmos_address)
  FROM public.profiles
  WHERE id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.get_user_cosmos_address(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_cosmos_address(uuid) TO service_role;
