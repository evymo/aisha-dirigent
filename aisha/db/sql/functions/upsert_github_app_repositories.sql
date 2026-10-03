-- Function: public.upsert_github_app_repositories
-- Named, audited replacement for the raw_query_admin upsert in
-- svc-github-app/routes/webhook-bridge.ts (installation_repositories webhook).
-- Bulk-upserts the repo cache from a jsonb array of rows. Idempotent on
-- (installation_id, repo_id).
-- Security: SECURITY DEFINER (service_role-invoked via rpcService), search_path pinned.

CREATE OR REPLACE FUNCTION public.upsert_github_app_repositories(
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a jsonb array' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.github_app_repositories
    (installation_id, repo_id, repo_full_name, is_private, default_branch, is_active, updated_at)
  SELECT
    (r ->> 'installation_id')::bigint,
    (r ->> 'repo_id')::bigint,
    r ->> 'repo_full_name',
    COALESCE((r ->> 'is_private')::boolean, true),
    COALESCE(NULLIF(r ->> 'default_branch', ''), 'main'),
    COALESCE((r ->> 'is_active')::boolean, true),
    COALESCE((r ->> 'updated_at')::timestamptz, now())
  FROM jsonb_array_elements(p_rows) AS r
  ON CONFLICT (installation_id, repo_id) DO UPDATE
    SET repo_full_name = EXCLUDED.repo_full_name,
        is_private     = EXCLUDED.is_private,
        default_branch = EXCLUDED.default_branch,
        is_active      = EXCLUDED.is_active,
        updated_at     = now();
END;
$function$;

COMMENT ON FUNCTION public.upsert_github_app_repositories(jsonb) IS
  'Bulk-upsert of the GitHub App repo cache from a jsonb array (idempotent on installation_id + repo_id).';

REVOKE ALL ON FUNCTION public.upsert_github_app_repositories(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_github_app_repositories(jsonb) TO service_role;
