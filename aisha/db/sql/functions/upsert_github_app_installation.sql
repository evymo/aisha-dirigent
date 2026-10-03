-- Function: public.upsert_github_app_installation
-- Named, audited replacement for the raw_query_admin INSERT..ON CONFLICT in
-- svc-github-app/routes/webhook-bridge.ts (installation.created webhook).
-- Registers/refreshes a GitHub App installation row. Idempotent on installation_id;
-- a re-install (created event after a prior suspend/uninstall) clears suspended_at.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.upsert_github_app_installation(
  p_installation_id bigint,
  p_account_login text,
  p_account_type text,
  p_permissions jsonb DEFAULT '{}'::jsonb,
  p_repository_selection text DEFAULT 'selected'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_installation_id IS NULL THEN
    RAISE EXCEPTION 'installation_id is required' USING ERRCODE = 'check_violation';
  END IF;

  IF p_account_login IS NULL OR p_account_type IS NULL THEN
    RAISE EXCEPTION 'account_login and account_type are required' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.github_app_installations
    (installation_id, account_login, account_type, permissions, repository_selection)
  VALUES
    (p_installation_id,
     p_account_login,
     p_account_type,
     COALESCE(p_permissions, '{}'::jsonb),
     COALESCE(NULLIF(p_repository_selection, ''), 'selected'))
  ON CONFLICT (installation_id) DO UPDATE
    SET account_login        = EXCLUDED.account_login,
        account_type         = EXCLUDED.account_type,
        permissions          = EXCLUDED.permissions,
        repository_selection = EXCLUDED.repository_selection,
        suspended_at         = NULL,
        updated_at           = now();
END;
$function$;

COMMENT ON FUNCTION public.upsert_github_app_installation(bigint, text, text, jsonb, text) IS
  'Registers/refreshes a GitHub App installation (idempotent on installation_id; clears suspended_at on re-install).';

REVOKE ALL ON FUNCTION public.upsert_github_app_installation(bigint, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_github_app_installation(bigint, text, text, jsonb, text) TO service_role;
