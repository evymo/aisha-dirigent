-- get_app_secrets_batch: Retrieve multiple secrets by key array from the VAULT (encrypted).
-- Dřív četla nešifrovanou tabulku app_secrets (viz get_app_secret).
-- Called by: github-app-auth/index.ts for GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY
-- SECURITY: service_role only
CREATE OR REPLACE FUNCTION public.get_app_secrets_batch(
  p_keys text[]
)
RETURNS TABLE(key text, value text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Auth: JEN služba (service_role). ⛔ Dřív `auth.uid() IS NULL → Not authenticated`:
  -- servisní token nenese `sub`, takže volání SLUŽBY (gateway deployment-executor,
  -- svc-github-app) vždy padlo a čtenář tiše přešel na env (rozbor úložišť
  -- pověření, Guru 2026-09-28). Uživatel s `sub` tajemství číst nemá.
  IF public.get_jwt_role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Forbidden: service_role required' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT DISTINCT ON (ds.name) ds.name::text, ds.decrypted_secret::text
  FROM vault.decrypted_secrets ds
  WHERE ds.name = ANY(p_keys)
  ORDER BY ds.name, ds.updated_at DESC NULLS LAST;
END;
$$;

REVOKE ALL ON FUNCTION public.get_app_secrets_batch(text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_app_secrets_batch(text[]) TO service_role;
