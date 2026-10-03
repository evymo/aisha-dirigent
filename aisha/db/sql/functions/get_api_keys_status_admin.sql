-- Function: get_api_keys_status_admin
-- Purpose: Admin RPC pro zobrazení statusu API klíčů (bez skutečných hodnot)
-- Storage: Reads from Supabase Vault (encrypted at rest)
-- Security: SECURITY DEFINER + admin-only

CREATE OR REPLACE FUNCTION get_api_keys_status_admin()
RETURNS TABLE (
  key_name TEXT,
  is_set BOOLEAN,
  updated_at TIMESTAMPTZ,
  masked_value TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  -- Authorization: pouze admin
  IF NOT EXISTS (
    SELECT 1 FROM user_roles
    WHERE user_id = v_user_id
    AND role IN ('admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: admin role required';
  END IF;

  -- Audit log
  INSERT INTO audit_journal (user_id, action, metadata)
  VALUES (
    v_user_id,
    'ADMIN_VIEW_API_KEYS_STATUS',
    jsonb_build_object('area', 'admin', 'severity', 'info')
  );

  -- ⛔ ZPEVNĚNÍ (b) 2026-09-29: STAV = PŘÍTOMNOST, NE HODNOTA. Dřív se `is_set` počítal
  -- DEŠIFROVÁNÍM (vault.decrypted_secrets) a `masked_value` vracel první a poslední
  -- 4 znaky tajemství — kus hodnoty v prohlížeči admina. Teď se čte jen řádek trezoru
  -- (vault.secrets, bez dešifrování); `masked_value` zůstává kvůli tvaru, který čte
  -- správa (AllApiKeysManager), ale nese jen pevnou masku.
  RETURN QUERY
  WITH known_keys AS (
    SELECT unnest(ARRAY[
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
    ]) AS kn
  )
  SELECT
    kk.kn AS key_name,
    (vs.id IS NOT NULL) AS is_set,
    vs.updated_at,
    CASE WHEN vs.id IS NULL THEN NULL ELSE '••••' END AS masked_value
  FROM known_keys kk
  LEFT JOIN vault.secrets vs ON vs.name = kk.kn
  ORDER BY key_name;
END;
$$;

-- Permissions
REVOKE ALL ON FUNCTION get_api_keys_status_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_api_keys_status_admin() TO authenticated;

COMMENT ON FUNCTION get_api_keys_status_admin() IS
  'Admin-only: Returns masked status of all API keys. Storage: Supabase Vault (encrypted).';
