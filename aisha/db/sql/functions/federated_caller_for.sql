-- ============================================================================
-- Source of Truth: federated_caller_for
-- Popis: Provider-generic federation resolver — the AISHA user's external identity
--        at a given provider, so a connector can drive that external system AS THE
--        REAL USER (caller_id federation, connector doctrine). Generalizes
--        the named predecessor over the already provider-generic aisha_auth.identities;
--        a new controllable source declares only its provider slug and reuses this.
--
-- Fail-CLOSED authz via is_service_role() (NOT the inline NULL-3VL idiom that the
-- named predecessor carried). Returns the provider_id or NULL if unlinked.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.federated_caller_for(
  p_provider text,
  p_user_id  uuid
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'aisha_auth'
AS $$
DECLARE v_caller text;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;
  IF p_provider IS NULL OR btrim(p_provider) = '' THEN
    RAISE EXCEPTION 'federated_caller_for: a provider is required';
  END IF;
  SELECT provider_id INTO v_caller
  FROM aisha_auth.identities
  WHERE user_id = p_user_id AND provider = p_provider
  LIMIT 1;
  RETURN v_caller;
END;
$$;

REVOKE ALL ON FUNCTION public.federated_caller_for(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.federated_caller_for(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.federated_caller_for(text, uuid) TO service_role;
