-- Function: set_system_config_admin
-- Purpose: Admin RPC for upserting system configuration entries
-- Security: SECURITY DEFINER + admin-only

DROP FUNCTION IF EXISTS public.set_system_config_admin(TEXT, JSONB, TEXT, TEXT, BOOLEAN);
DROP FUNCTION IF EXISTS public.set_system_config_admin(TEXT, JSONB, TEXT, TEXT, BOOLEAN, TIMESTAMPTZ);

CREATE OR REPLACE FUNCTION set_system_config_admin(
  p_category TEXT DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_expected_updated_at TIMESTAMPTZ DEFAULT NULL,
  p_is_public BOOLEAN DEFAULT false,
  p_key TEXT DEFAULT NULL,
  p_value JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_category TEXT := COALESCE(NULLIF(p_category, ''), 'general');
  v_existing_updated_at TIMESTAMPTZ;
  v_new_updated_at TIMESTAMPTZ := now();
BEGIN
  -- Authorization: admin only
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user_id
      AND role IN ('admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  IF p_key IS NULL OR btrim(p_key) = '' THEN
    RAISE EXCEPTION 'key cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF p_value IS NULL THEN
    RAISE EXCEPTION 'value cannot be null' USING ERRCODE = '22023';
  END IF;

  SELECT updated_at
  INTO v_existing_updated_at
  FROM system_config
  WHERE key = p_key
  FOR UPDATE;

  IF p_expected_updated_at IS NOT NULL
     AND v_existing_updated_at IS DISTINCT FROM p_expected_updated_at THEN
    RAISE EXCEPTION USING
      MESSAGE = 'system_config_conflict',
      ERRCODE = '40001';
  END IF;

  INSERT INTO system_config (key, value, description, category, is_public, updated_at, updated_by)
  VALUES (p_key, p_value, p_description, v_category, p_is_public, v_new_updated_at, v_user_id)
  ON CONFLICT (key)
  DO UPDATE SET
    value = EXCLUDED.value,
    description = COALESCE(EXCLUDED.description, system_config.description),
    category = EXCLUDED.category,
    is_public = EXCLUDED.is_public,
    updated_at = v_new_updated_at,
    updated_by = v_user_id;

  -- Audit log (no sensitive values)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ADMIN_SET_SYSTEM_CONFIG',
    jsonb_build_object(
      'area', 'admin',
      'severity', 'info',
      'key', p_key,
      'category', v_category,
      'is_public', p_is_public
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'key', p_key,
    'category', v_category,
    'is_public', p_is_public,
    'updated_at', v_new_updated_at
  );
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION set_system_config_admin(TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_system_config_admin(TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB) TO authenticated;

COMMENT ON FUNCTION set_system_config_admin(TEXT, TEXT, TIMESTAMPTZ, BOOLEAN, TEXT, JSONB) IS 'Admin-only: Upsert system_config entries with audit logging and optional CAS guard';
