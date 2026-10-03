-- Function: public.link_installation_to_partner
-- Links a GitHub App installation to a partner profile.
-- @security: admin/staff only (SECURITY INVOKER)

CREATE OR REPLACE FUNCTION public.link_installation_to_partner(
  p_installation_id bigint,
  p_partner_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
DECLARE
  v_row public.github_app_installations;
BEGIN
  IF NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin or staff role required';
  END IF;

  UPDATE public.github_app_installations
  SET partner_id = p_partner_id,
      updated_at = now()
  WHERE installation_id = p_installation_id
    AND suspended_at IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Installation % not found or suspended', p_installation_id;
  END IF;

  INSERT INTO public.audit_journal (user_id, action, metadata)
  VALUES (
    auth.uid(),
    'GITHUB_INSTALLATION_LINKED',
    jsonb_build_object(
      'installation_id', p_installation_id,
      'partner_id', p_partner_id,
      'account_login', v_row.account_login,
      'area', 'github_app',
      'severity', 'info'
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'installation_id', p_installation_id,
    'partner_id', p_partner_id,
    'account_login', v_row.account_login
  );
END;
$$;

REVOKE ALL ON FUNCTION public.link_installation_to_partner(bigint, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_installation_to_partner(bigint, uuid) TO authenticated;
