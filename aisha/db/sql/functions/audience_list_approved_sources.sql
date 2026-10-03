-- Function: public.audience_list_approved_sources
-- ENT-01 multi-source enumeration (SOURCE_ONBOARDING_CONTRACT §6/§7): returns the
-- APPROVED, ACTIVE federated sources over the story federation spine so the broker
-- (svc-source-broker scheduler) can sync EVERY approved source per-source, instead
-- of pinning to one hardcoded slug. A source is a story (partner_stories)
-- materialised on an active instance (story_instances) that carries a live
-- source_pg_readonly endpoint binding AND whose metadata.source_approved = true.
--
-- Namespace scoping (contract §6, "caller's namespace"): when p_namespace is
-- supplied only sources in that namespace are returned; the trusted broker
-- (service_role) passes NULL to enumerate all approved sources it must drain.
--
-- Security: SECURITY DEFINER, search_path pinned. Operator (admin/staff) OR trusted
--   service only (NULL-safe deny-guard, mirroring audience_resolve_source_binding).
--   Returns the credential REFERENCE (auth_secret_ref), never the secret. The
--   `audience_` prefix auto-inherits audience_autorevoke_public_execute (revokes
--   PUBLIC/anon EXECUTE) + the audience_audit_grants regression gate.

CREATE OR REPLACE FUNCTION public.audience_list_approved_sources(
  p_namespace text DEFAULT NULL
)
  RETURNS TABLE (
    source_id        uuid,
    story_id         uuid,
    source_slug      text,
    namespace        text,
    data_sensitivity text,
    endpoint_url     text,
    auth_secret_ref  text,
    last_sync_at     timestamp with time zone
  )
  LANGUAGE plpgsql
  STABLE
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    si.id                                     AS source_id,
    si.story_id                               AS story_id,
    ps.title                                  AS source_slug,
    si.metadata ->> 'namespace'               AS namespace,
    si.metadata ->> 'data_sensitivity'        AS data_sensitivity,
    b.endpoint_url                            AS endpoint_url,
    b.auth_secret_ref                         AS auth_secret_ref,
    si.last_sync_at                           AS last_sync_at
  FROM public.story_instances si
  JOIN public.partner_stories ps
    ON ps.id = si.story_id
  JOIN public.instance_endpoint_bindings b
    ON b.instance_id = si.id
   AND b.endpoint_role = 'source_pg_readonly'
   AND b.is_active = true
  WHERE si.status = 'active'
    AND COALESCE((si.metadata ->> 'source_approved')::boolean, false) = true
    AND (p_namespace IS NULL OR si.metadata ->> 'namespace' = p_namespace)
  ORDER BY ps.title, si.instance_label;
END;
$function$;

COMMENT ON FUNCTION public.audience_list_approved_sources(text) IS
  'ENT-01 multi-source enumeration: approved + active federated sources over the '
  'story spine (story_instances + instance_endpoint_bindings, metadata.source_approved), '
  'optionally scoped to a namespace. Returns endpoint + credential REFERENCE (not the '
  'secret). Admin/staff or service_role only. Drives svc-source-broker per-source sync.';

REVOKE ALL ON FUNCTION public.audience_list_approved_sources(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_list_approved_sources(text) TO authenticated, service_role;
