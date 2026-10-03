-- Function: get_my_wearable_connections
-- Purpose: Get current user's wearable device connections
-- Access: authenticated
-- Security: SECURITY INVOKER (respects RLS on member_wearable_connections)

CREATE OR REPLACE FUNCTION public.get_my_wearable_connections()
RETURNS TABLE (
  id uuid,
  connection_status text,
  created_at timestamptz,
  device_model text,
  device_name text,
  device_type text,
  last_sync_at timestamptz,
  metadata jsonb,
  permissions_granted text[],
  platform text,
  sync_count int4,
  updated_at timestamptz
)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  RETURN QUERY
  SELECT
    mwc.id,
    mwc.connection_status,
    mwc.created_at,
    mwc.device_model,
    mwc.device_name,
    mwc.device_type,
    mwc.last_sync_at,
    mwc.metadata,
    mwc.permissions_granted,
    mwc.platform,
    mwc.sync_count,
    mwc.updated_at
  FROM member_wearable_connections mwc
  WHERE mwc.user_id = v_user_id
  ORDER BY mwc.connection_status = 'connected' DESC, mwc.updated_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_wearable_connections() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_wearable_connections() TO authenticated;

COMMENT ON FUNCTION public.get_my_wearable_connections() IS
  'Get current user wearable device connections. SECURITY INVOKER — RLS enforces row-level filtering.';
