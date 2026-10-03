-- Function: public.deactivate_github_app_repositories
-- Named, audited replacement for the raw_query_admin update in
-- svc-github-app/routes/webhook-bridge.ts — marks repos removed from a GitHub App
-- installation as inactive (soft delete). Called on installation_repositories
-- (removed) webhooks.
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.deactivate_github_app_repositories(
  p_installation_id bigint,
  p_repo_ids bigint[]
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

  IF p_repo_ids IS NULL OR array_length(p_repo_ids, 1) IS NULL THEN
    RETURN; -- nothing to deactivate
  END IF;

  UPDATE public.github_app_repositories
     SET is_active = false,
         updated_at = now()
   WHERE installation_id = p_installation_id
     AND repo_id = ANY (p_repo_ids);
END;
$function$;

COMMENT ON FUNCTION public.deactivate_github_app_repositories(bigint, bigint[]) IS
  'Soft-deactivates repos removed from a GitHub App installation (is_active=false).';

REVOKE ALL ON FUNCTION public.deactivate_github_app_repositories(bigint, bigint[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deactivate_github_app_repositories(bigint, bigint[]) TO service_role;
