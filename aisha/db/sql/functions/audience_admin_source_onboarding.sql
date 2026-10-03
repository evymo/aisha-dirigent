-- Function: audience_admin_source_onboarding
-- Source Onboarding Contract (docs/enterprise/SOURCE_ONBOARDING_CONTRACT.md §7)
-- Governed replacement for the direct-granted view audience_admin_source_onboarding_v.
--
-- N2 fix — why this exists:
--   The #572 view ran OWNER-RIGHTS (owned by aisha_admin) and shipped a direct
--   GRANT SELECT TO authenticated (+ the public-schema default grant reaching anon).
--   A SECURITY DEFINER-equivalent view with a blanket SELECT grant bypasses RLS on
--   the underlying spine → PII/classification leak to any logged-in (or anon) caller.
--   This RPC serves the SAME onboarding/classification projection through an
--   admin-gated SECURITY DEFINER function: is_admin_or_staff() is enforced BEFORE
--   any row is read, and EXECUTE is REVOKEd from PUBLIC. RETURNS TABLE preserves the
--   tabular shape for PostgREST / Appsmith. The audience_ prefix inherits the
--   audience_autorevoke_public_execute + audience_audit_grants regression gates.
--
-- Model correction (the substantive fix, not just a wrapper):
--   The #572 view read integration_services — WRONG: that is the nocodb/langfuse/n8n
--   service registry, not the source registry, so every classification dimension was
--   COALESCE-derived from a config jsonb over the wrong table. In the corrected model
--   a SOURCE is a STORY materialised on an instance: read the STORY SPINE
--   (story_instances si JOIN partner_stories ps ON ps.id = si.story_id), keeping only
--   instances that carry a 'source_pg_readonly' endpoint binding. Lifecycle state
--   (status, last_sync_at, endpoint_url, is_active) is therefore REAL, and the
--   4-dimension classification (source_type, data_sensitivity, retention_class,
--   legal_basis) + namespace + approval are materialised from the instance metadata
--   jsonb written by the onboarding flow. Drives the extranet "Zdraví & správa zdrojů".

-- N2 cleanup: DROP the superseded #572 leaky view. It ran OWNER-RIGHTS with a
-- direct GRANT SELECT TO authenticated (+ the public-schema default reaching
-- anon) → a PII/classification leak of the WHOLE source registry (config, legal
-- basis, namespace…) to any logged-in or anon caller, RLS bypassed. This governed
-- SECURITY DEFINER function (is_admin_or_staff() enforced) replaces it; DROP the
-- view so any DB created before this fix converges to the admin-gated function
-- and loses the leak. IF EXISTS = idempotent; nothing depends on the view.
DROP VIEW IF EXISTS public.audience_admin_source_onboarding_v;

CREATE OR REPLACE FUNCTION public.audience_admin_source_onboarding()
 RETURNS TABLE(
   source_id uuid,
   story_id uuid,
   source_slug text,
   display_name text,
   instance_type text,
   is_origin boolean,
   status text,
   source_type text,
   data_sensitivity text,
   retention_class text,
   legal_basis text,
   namespace text,
   is_approved boolean,
   approved_at timestamp with time zone,
   last_sync_at timestamp with time zone,
   endpoint_url text,
   is_active boolean
 )
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT is_admin_or_staff() THEN
    RAISE EXCEPTION 'Access denied' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT
    si.id                                                        AS source_id,
    si.story_id                                                  AS story_id,
    -- Source slug: the story title is the human-facing source name/slug on the spine.
    ps.title                                                     AS source_slug,
    si.instance_label                                            AS display_name,
    si.instance_type                                             AS instance_type,
    si.is_origin                                                 AS is_origin,
    -- Real lifecycle status from the instance (replaces the registry health_status).
    si.status                                                    AS status,
    -- 4-dimension classification (Contract §2/§4/§5/§6) — materialised from the
    -- instance metadata written by the onboarding flow, NOT derived over a wrong
    -- registry with COALESCE fallbacks.
    si.metadata ->> 'source_type'                                AS source_type,
    si.metadata ->> 'data_sensitivity'                           AS data_sensitivity,
    si.metadata ->> 'retention_class'                            AS retention_class,
    si.metadata ->> 'legal_basis'                                AS legal_basis,
    si.metadata ->> 'namespace'                                  AS namespace,
    COALESCE((si.metadata ->> 'source_approved')::boolean, false) AS is_approved,
    (si.metadata ->> 'approved_at')::timestamptz                 AS approved_at,
    si.last_sync_at                                              AS last_sync_at,
    -- Live endpoint + activation come from the source binding itself.
    b.endpoint_url                                               AS endpoint_url,
    b.is_active                                                  AS is_active
  FROM public.story_instances si
  JOIN public.partner_stories ps
    ON ps.id = si.story_id
  -- INNER JOIN on the unique (instance_id, endpoint_role) binding both FILTERS the
  -- spine to instances that HAVE a source binding (equivalent to the required
  -- EXISTS) and supplies endpoint_url + is_active with no row multiplication
  -- (instance_endpoint_bindings_unique_role guarantees at most one row per role).
  JOIN public.instance_endpoint_bindings b
    ON b.instance_id = si.id
   AND b.endpoint_role = 'source_pg_readonly'
  ORDER BY ps.title, si.instance_label;
END;
$function$
;

REVOKE ALL ON FUNCTION public.audience_admin_source_onboarding() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.audience_admin_source_onboarding() TO authenticated;
GRANT EXECUTE ON FUNCTION public.audience_admin_source_onboarding() TO authenticator;
GRANT EXECUTE ON FUNCTION public.audience_admin_source_onboarding() TO service_role;

COMMENT ON FUNCTION public.audience_admin_source_onboarding() IS
  'Source Onboarding Contract (§7) governed reader — admin-gated SECURITY DEFINER
   replacement for the RLS-bypassing view audience_admin_source_onboarding_v (fixes
   N2: owner-rights view + direct GRANT SELECT TO authenticated/anon). Projects one
   row per onboarded data source from the STORY SPINE (story_instances JOIN
   partner_stories, filtered to instances carrying a source_pg_readonly endpoint
   binding), NOT integration_services. Returns identity + real lifecycle (status,
   last_sync_at, endpoint_url, is_active) + the 4-dimension classification
   (source_type, data_sensitivity, retention_class, legal_basis) + namespace +
   approval, materialised from instance metadata written by the onboarding flow.
   is_admin_or_staff() enforced (ERRCODE 42501); EXECUTE revoked from PUBLIC. audience_
   prefix inherits the autorevoke + audit-grants gates. Drives extranet
   "Zdraví & správa zdrojů".';
