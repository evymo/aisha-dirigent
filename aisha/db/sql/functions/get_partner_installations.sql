-- Function: public.get_partner_installations
-- Returns all GitHub App installations linked to a partner.
-- @security: admin/staff only (SECURITY INVOKER)

CREATE OR REPLACE FUNCTION public.get_partner_installations(
  p_partner_id uuid
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
        'id', i.id,
        'installation_id', i.installation_id,
        'account_login', i.account_login,
        'account_type', i.account_type,
        'permissions', i.permissions,
        'repository_selection', i.repository_selection,
        'is_active', i.suspended_at IS NULL,
        'installed_at', i.created_at,
        'repo_count', (
          SELECT COUNT(*)
          FROM public.github_app_repositories r
          WHERE r.installation_id = i.installation_id AND r.is_active = true
        )
      )
      ORDER BY i.created_at DESC
    ), '[]'::jsonb)
    FROM public.github_app_installations i
    WHERE i.partner_id = p_partner_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_installations(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_partner_installations(uuid) TO authenticated;
