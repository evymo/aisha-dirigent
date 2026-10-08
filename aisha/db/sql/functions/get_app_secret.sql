-- get_app_secret: Retrieve a single secret value by key from the VAULT (encrypted).
-- Dřív četla nešifrovanou tabulku app_secrets; ta se převádí do trezoru
-- (migrate_app_secrets_to_vault) a přímý grant na ni nemá nikdo.
-- Called by: deployment-executor/index.ts (3x) for SSH keys, credentials
-- SECURITY: service_role only — secrets must not be accessible from frontend
CREATE OR REPLACE FUNCTION public.get_app_secret(
  p_key text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_value text;
BEGIN
  -- Auth: JEN služba (service_role). ⛔ Dřív `auth.uid() IS NULL → Not authenticated`:
  -- servisní token nenese `sub`, takže volání SLUŽBY (gateway deployment-executor,
  -- svc-github-app) vždy padlo a čtenář tiše přešel na env (rozbor úložišť
  -- pověření, Guru 2026-09-28). Uživatel s `sub` tajemství číst nemá.
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required' USING ERRCODE = '42501';
  END IF;

  SELECT ds.decrypted_secret INTO v_value
  FROM vault.decrypted_secrets ds
  WHERE ds.name = p_key
    AND ds.name NOT LIKE 'credential:%'
  ORDER BY ds.updated_at DESC NULLS LAST
  LIMIT 1;

  RETURN v_value;
END;
$$;

REVOKE ALL ON FUNCTION public.get_app_secret(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_secret(text) TO service_role;
