-- ============================================================================
-- Source of Truth: hub_assert_source_writable
-- Popis: The fail-closed governance gate every connector WRITE passes before it
--        mutates. Resolves the story-spine binding (audience_resolve_source_binding)
--        and RAISEs unless the source is APPROVED and classified. Makes "a source
--        cannot be written unless onboarded/approved" a DB law, not a convention.
--
-- Called from connector write procs with the source's story reference. Returns the
-- resolved data_sensitivity (so the caller can enforce retention/PII rules) — or
-- RAISEs 42501 if unapproved / no binding. Fail-closed by construction: an absent
-- instance, absent binding, or source_approved=false all deny.
--
-- Internal-only: REVOKEd from PUBLIC (callers are SECURITY DEFINER, run as owner).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_assert_source_writable(
  p_story_id      uuid,
  p_endpoint_role text DEFAULT 'control-api'
)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_sensitivity text;
  v_approved    boolean;
  v_found       boolean := false;
BEGIN
  -- Self-gate (defense in depth; the inner resolver also gates): only a trusted
  -- caller may probe source approval.
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_story_id IS NULL THEN
    RAISE EXCEPTION 'hub_assert_source_writable: story reference is required'
      USING ERRCODE = '42501';
  END IF;

  -- audience_resolve_source_binding self-gates (service_role or admin/staff) and
  -- fail-closes classification/approval (unclassified => 'restricted', unapproved
  -- => false). It RAISEs no_data_found when no active instance materializes.
  BEGIN
    SELECT rb.data_sensitivity, rb.is_approved
      INTO v_sensitivity, v_approved
    FROM public.audience_resolve_source_binding(p_story_id, p_endpoint_role) rb
    LIMIT 1;
    v_found := FOUND;
  EXCEPTION WHEN no_data_found THEN
    RAISE EXCEPTION 'hub_assert_source_writable: no active instance for story %', p_story_id
      USING ERRCODE = '42501';
  END;

  IF NOT v_found OR v_approved IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'hub_assert_source_writable: source for story % (%s) is not approved',
      p_story_id, p_endpoint_role
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(v_sensitivity, 'restricted');
END;
$$;

-- Read-only approval check (no mutation); wraps audience_resolve_source_binding,
-- which is itself granted authenticated+service_role — same exposure.
REVOKE ALL ON FUNCTION public.hub_assert_source_writable(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_assert_source_writable(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_assert_source_writable(uuid, text) TO service_role;
