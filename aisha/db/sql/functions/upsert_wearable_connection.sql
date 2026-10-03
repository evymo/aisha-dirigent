-- Function: upsert_wearable_connection
-- Purpose: Create or update a wearable device connection for the current user
-- Access: authenticated
-- Security: SECURITY DEFINER with audit logging

CREATE OR REPLACE FUNCTION public.upsert_wearable_connection(
  p_connection_status text DEFAULT 'connected',
  p_device_model text DEFAULT NULL,
  p_device_name text DEFAULT NULL,
  p_device_type text DEFAULT NULL,
  p_last_sync_batch_id uuid DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_permissions_granted text[] DEFAULT '{}',
  p_platform text DEFAULT 'ios'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID;
  v_connection_id UUID;
  v_is_new BOOLEAN := false;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Validate inputs
  IF p_device_type IS NULL OR p_device_type = '' THEN
    RAISE EXCEPTION 'device_type is required';
  END IF;

  IF p_platform NOT IN ('ios', 'android') THEN
    RAISE EXCEPTION 'platform must be ios or android';
  END IF;

  IF p_connection_status NOT IN ('connected', 'disconnected', 'paused') THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid connection_status: %s', p_connection_status), ERRCODE = '22023';
  END IF;

  -- Upsert: insert or update based on unique constraint (user_id, device_type, platform)
  INSERT INTO member_wearable_connections (
    user_id,
    device_type,
    device_name,
    device_model,
    platform,
    connection_status,
    permissions_granted,
    last_sync_batch_id,
    last_sync_at,
    metadata,
    disconnected_at
  )
  VALUES (
    v_user_id,
    p_device_type,
    p_device_name,
    p_device_model,
    p_platform,
    p_connection_status,
    p_permissions_granted,
    p_last_sync_batch_id,
    CASE WHEN p_last_sync_batch_id IS NOT NULL THEN now() ELSE NULL END,
    p_metadata,
    CASE WHEN p_connection_status = 'disconnected' THEN now() ELSE NULL END
  )
  ON CONFLICT (user_id, device_type, platform)
  DO UPDATE SET
    device_name = COALESCE(EXCLUDED.device_name, member_wearable_connections.device_name),
    device_model = COALESCE(EXCLUDED.device_model, member_wearable_connections.device_model),
    connection_status = EXCLUDED.connection_status,
    permissions_granted = EXCLUDED.permissions_granted,
    last_sync_batch_id = COALESCE(EXCLUDED.last_sync_batch_id, member_wearable_connections.last_sync_batch_id),
    last_sync_at = CASE
      WHEN EXCLUDED.last_sync_batch_id IS NOT NULL THEN now()
      ELSE member_wearable_connections.last_sync_at
    END,
    sync_count = CASE
      WHEN EXCLUDED.last_sync_batch_id IS NOT NULL THEN member_wearable_connections.sync_count + 1
      ELSE member_wearable_connections.sync_count
    END,
    metadata = member_wearable_connections.metadata || EXCLUDED.metadata,
    disconnected_at = CASE
      WHEN EXCLUDED.connection_status = 'disconnected' THEN now()
      ELSE NULL
    END,
    updated_at = now()
  RETURNING id, (xmax = 0) INTO v_connection_id, v_is_new;

  -- Audit log (no sensitive data)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    CASE WHEN v_is_new THEN 'WEARABLE_CONNECTED' ELSE 'WEARABLE_UPDATED' END,
    jsonb_build_object(
      'area', 'wearable',
      'severity', 'info',
      'connection_id', v_connection_id,
      'device_type', p_device_type,
      'platform', p_platform,
      'connection_status', p_connection_status
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'connection_id', v_connection_id,
    'is_new', v_is_new
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_wearable_connection(text, text, text, text, uuid, jsonb, text[][], text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_wearable_connection(text, text, text, text, uuid, jsonb, text[][], text) TO authenticated;

COMMENT ON FUNCTION public.upsert_wearable_connection(text, text, text, text, uuid, jsonb, text[][], text) IS
  'Create or update a wearable device connection for the current user. Supports multi-device per user.';
