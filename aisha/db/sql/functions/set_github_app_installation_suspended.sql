-- Function: public.set_github_app_installation_suspended
-- Named, audited replacement for the two raw_query_admin UPDATEs in
-- svc-github-app/routes/webhook-bridge.ts (installation.suspend / deleted /
-- unsuspend webhooks). Toggles the suspended_at soft-delete marker:
--   p_suspended = true  -> suspended_at = now()  (suspend / uninstall)
--   p_suspended = false -> suspended_at = NULL   (unsuspend / reactivate)
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.set_github_app_installation_suspended(
  p_installation_id bigint,
  p_suspended boolean
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

  IF p_suspended IS NULL THEN
    RAISE EXCEPTION 'p_suspended is required' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE public.github_app_installations
     SET suspended_at = CASE WHEN p_suspended THEN now() ELSE NULL END,
         updated_at   = now()
   WHERE installation_id = p_installation_id;
END;
$function$;

COMMENT ON FUNCTION public.set_github_app_installation_suspended(bigint, boolean) IS
  'Toggles the suspended_at soft-delete marker on a GitHub App installation (suspend/uninstall vs unsuspend).';

REVOKE ALL ON FUNCTION public.set_github_app_installation_suspended(bigint, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_github_app_installation_suspended(bigint, boolean) TO service_role;
