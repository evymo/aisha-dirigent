-- Function: public.get_public_chat_channels_admin
-- Arguments: (none)
-- Description: List all public chat channels for admin panel
-- Security: SECURITY DEFINER
-- Search path: public (set per-function below)
-- Source: migration 20260418130000_fix_self_improvement_foundation.sql

CREATE OR REPLACE FUNCTION public.get_public_chat_channels_admin()
RETURNS SETOF public_chat_channels
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Admin access required';
  END IF;
  RETURN QUERY SELECT pcc.*
  FROM public.public_chat_channels pcc
  ORDER BY pcc.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_chat_channels_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_chat_channels_admin() TO authenticated;
