-- Function: public.get_installation_repositories
-- Returns all active repositories for a GitHub App installation.
-- @security: admin/staff only (SECURITY INVOKER)

CREATE OR REPLACE FUNCTION public.get_installation_repositories(
  p_installation_id bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
STABLE
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  RETURN (
    SELECT COALESCE(jsonb_agg(
      jsonb_build_object(
        'repo_id', r.repo_id,
        'repo_full_name', r.repo_full_name,
        'is_private', r.is_private,
        'default_branch', r.default_branch,
        'is_active', r.is_active,
        'synced_at', r.updated_at
      )
      ORDER BY r.repo_full_name
    ), '[]'::jsonb)
    FROM public.github_app_repositories r
    WHERE r.installation_id = p_installation_id
      AND r.is_active = true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_installation_repositories(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_installation_repositories(bigint) TO authenticated;
