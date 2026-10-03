-- ============================================================================
-- Source of Truth: federated_identity_link
-- Popis: Provider-generic identity federation — link an AISHA user to their
--        external identity at any provider (connector doctrine). Generalizes
--        the named predecessor over aisha_auth.identities. Fail-CLOSED authz via
--        is_service_role(); the link is audited through connector_write_audit (v2
--        hashed, provable) instead of a best-effort raw INSERT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.federated_identity_link(
  p_provider    text,
  p_user_id     uuid,
  p_provider_id text,
  p_email       text DEFAULT NULL
)
RETURNS aisha_auth.identities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'aisha_auth'
AS $$
DECLARE v_row aisha_auth.identities;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;
  IF p_provider IS NULL OR btrim(p_provider) = ''
     OR p_user_id IS NULL
     OR p_provider_id IS NULL OR btrim(p_provider_id) = '' THEN
    RAISE EXCEPTION 'federated_identity_link: provider, user_id and a non-empty provider_id are required';
  END IF;

  INSERT INTO aisha_auth.identities (user_id, provider, provider_id, email, identity_data, last_sign_in_at)
  VALUES (p_user_id, p_provider, btrim(p_provider_id), p_email,
          jsonb_build_object('linked_via', 'federated_identity_link'), now())
  ON CONFLICT (provider, provider_id) DO UPDATE SET
    user_id    = EXCLUDED.user_id,
    email      = COALESCE(EXCLUDED.email, aisha_auth.identities.email),
    updated_at = now(), last_sign_in_at = now()
  RETURNING * INTO v_row;

  PERFORM public.connector_write_audit(
    'federated_identity.linked', 'curation', 'content', 'info',
    format('Federated an AISHA user to a %s identity', p_provider),
    'federated_identity', p_user_id::text,
    jsonb_build_object('provider', p_provider, 'provider_id', btrim(p_provider_id)),
    auth.uid(), p_provider);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.federated_identity_link(text, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.federated_identity_link(text, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.federated_identity_link(text, uuid, text, text) TO service_role;
