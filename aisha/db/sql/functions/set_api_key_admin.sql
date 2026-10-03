-- Function: set_api_key_admin
-- Purpose: Admin RPC pro nastavení nebo aktualizaci API klíče
-- Storage: Vault (encrypted at rest) — JEN trezor, žádná nešifrovaná kopie
-- Security: SECURITY DEFINER + admin-only + validace key_name

CREATE OR REPLACE FUNCTION set_api_key_admin(
  p_key_name TEXT,
  p_key_value TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_allowed_keys TEXT[] := ARRAY[
    'fio_bank_api_token',
    'homeassistant_access_token',
    'homeassistant_base_url',
    'openai_api_key',
    'packeta_api_key',
    'packeta_api_password',
    'packeta_sender_id',
    'stripe_publishable_key',
    'stripe_secret_key',
    'stripe_webhook_secret'
  ];
  v_existing_id UUID;
  v_description TEXT;
BEGIN
  -- Authorization: pouze admin
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user_id
    AND role IN ('admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Validace key_name
  IF NOT (p_key_name = ANY(v_allowed_keys)) THEN
    RAISE EXCEPTION USING MESSAGE = format('Invalid key_name: %s', p_key_name), ERRCODE = '22023';
  END IF;

  -- Validace key_value
  IF p_key_value IS NULL OR p_key_value = '' THEN
    RAISE EXCEPTION 'key_value cannot be empty' USING ERRCODE = '22023';
  END IF;

  v_description := jsonb_build_object('updated_by', v_user_id)::text;

  -- Upsert into Vault (encrypted at rest)
  SELECT id INTO v_existing_id FROM vault.secrets WHERE name = p_key_name;

  IF v_existing_id IS NOT NULL THEN
    PERFORM vault.update_secret(v_existing_id, p_key_value, p_key_name, v_description);
  ELSE
    PERFORM vault.create_secret(p_key_value, p_key_name, v_description);
  END IF;

  -- ⛔ ŽÁDNÁ NEŠIFROVANÁ KOPIE (2026-09-28): dřív se hodnota zapisovala i do
  -- `app_secrets` „pro zpětnou kompatibilitu" — a admin ji pak přečetl přes REST.
  -- Domov je jen trezor; čtenáři (get_app_secret, get_app_secrets_batch) čtou trezor.

  -- Audit log (bez hodnoty klíče!)
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ADMIN_SET_API_KEY',
    jsonb_build_object(
      'area', 'admin',
      'severity', 'warning',
      'key_name', p_key_name,
      'action', 'set',
      'storage', 'vault'
    )
  );

  RETURN jsonb_build_object('success', true, 'key_name', p_key_name);
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION set_api_key_admin(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION set_api_key_admin(TEXT, TEXT) TO authenticated;

COMMENT ON FUNCTION set_api_key_admin(text, text) IS
  'Admin-only: Set or update an API key. Storage: Supabase Vault (encrypted). Syncs to app_secrets for backward compat.';
