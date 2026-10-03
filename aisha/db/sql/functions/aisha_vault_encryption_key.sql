-- ============================================================================
-- Source of truth: aisha_vault_encryption_key
--
-- Klíč pgp_sym trezoru (vault.secrets). Hodnotu doručuje trezor instance
-- (VAULT_ENCRYPTION_KEY v env služby db) — NIKDY v repu.
--
-- ⛔ KLÍČ NENÍ GUC. Dřív ho nesl `ALTER DATABASE postgres SET
-- app.settings.vault_encryption_key`, PGOPTIONS služby db a PostgREST
-- `PGRST_APP_SETTINGS_VAULT_ENCRYPTION_KEY` (ten ho vkládal do KAŽDÉHO
-- požadavku). NAMĚŘENO 2026-09-25: četla ho každá role včetně anon přes /rpc.
--
-- ✅ Teď stejně jako aisha_column_encryption_key(): soubor
-- /run/aisha-keys/vault_encryption.key (entrypoint-wrapper.sh), čte jen
-- vlastník — tj. vault.create_secret/update_secret a SECURITY DEFINER
-- spotřebitelé pohledu vault.decrypted_secrets. Žádný GRANT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.aisha_vault_encryption_key()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'pg_temp'
AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    -- Bez ořezu: hodnota musí být BAJTOVĚ táž jako dřív v GUC (jinak starý
    -- šifrový text nejde otevřít); zapisovatel píše printf '%s', bez konce řádku.
    v_key := pg_read_file('/run/aisha-keys/vault_encryption.key');
  EXCEPTION
    WHEN undefined_file THEN
      RAISE EXCEPTION 'AISHA_VAULT_KEY_MISSING_OR_WEAK'
        USING DETAIL = 'Soubor /run/aisha-keys/vault_encryption.key neexistuje.',
              HINT = 'Zapisuje ho infra/postgres/entrypoint-wrapper.sh z VAULT_ENCRYPTION_KEY při startu služby db.';
  END;
  -- Jen prázdnota, ne délka: dřívější čtení z GUC délku neověřovalo a instance
  -- se starším (kratším) klíčem nesmí po změně DORUČENÍ přijít o trezor.
  IF v_key IS NULL OR v_key = '' THEN
    RAISE EXCEPTION 'AISHA_VAULT_KEY_MISSING_OR_WEAK';
  END IF;
  RETURN v_key;
END;
$$;
REVOKE ALL ON FUNCTION public.aisha_vault_encryption_key() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.aisha_vault_encryption_key() FROM anon, authenticated, service_role;
