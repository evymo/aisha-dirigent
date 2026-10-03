-- Function: public.get_github_app_secrets_from_vault
-- Returns GitHub App credentials (app_id + private_key) from Supabase Vault.
-- JEN trezor (2026-09-28): záloha na nešifrovanou app_secrets zrušena a chyba
-- trezoru se nespolyká — tichá záloha by z rozbitého trezoru udělala čtení
-- nešifrované kopie (přesně tak to běželo, dokud #1080 trezor neopravil).
-- @security: service_role only

CREATE OR REPLACE FUNCTION public.get_github_app_secrets_from_vault()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_app_id     text;
  v_private_key text;
BEGIN
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required';
  END IF;

  SELECT decrypted_secret INTO v_app_id
    FROM vault.decrypted_secrets
   WHERE name = 'GITHUB_APP_ID'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  SELECT decrypted_secret INTO v_private_key
    FROM vault.decrypted_secrets
   WHERE name = 'GITHUB_APP_PRIVATE_KEY'
   ORDER BY updated_at DESC NULLS LAST
   LIMIT 1;

  RETURN jsonb_build_object(
    'app_id', v_app_id,
    'private_key', v_private_key,
    'source', CASE
      WHEN v_app_id IS NOT NULL AND v_private_key IS NOT NULL THEN 'vault'
      ELSE 'not_found'
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_github_app_secrets_from_vault() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_github_app_secrets_from_vault() TO service_role;
