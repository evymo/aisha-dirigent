-- ============================================================================
-- Source of Truth: hub_verify_provenance
-- Popis: Generic provenance check for ANY connector action, keyed by the business
--        entity (not the internal audit id). Finds the latest audit_journal row
--        matching (entity_type, entity_id, action) and returns
--        fn_verify_audit_journal_entry's verdict. The universal generalization of
--        hub_verify_reprice_provenance — any connector state change is provable.
--
-- Returns jsonb: { entity_type, entity_id, action, state, audit_id, decided_at,
--   stored_hash }. state ∈ verified | broken | unverifiable_legacy | no_hash |
--   no_audit (no matching row). Gated admin/staff OR service_role.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_verify_provenance(
  p_entity_type text,
  p_entity_id   text,
  p_action      text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_audit  public.audit_journal%ROWTYPE;
  v_verify jsonb;
BEGIN
  IF NOT (public.is_service_role() OR public.is_admin_or_staff()) THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  SELECT * INTO v_audit
  FROM public.audit_journal
  WHERE entity_type = p_entity_type
    AND entity_id   = p_entity_id
    AND action      = p_action
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_audit.id IS NULL THEN
    RETURN jsonb_build_object(
      'entity_type', p_entity_type, 'entity_id', p_entity_id, 'action', p_action,
      'state', 'no_audit', 'audit_id', NULL);
  END IF;

  v_verify := public.fn_verify_audit_journal_entry(v_audit.id);

  RETURN jsonb_build_object(
    'entity_type', p_entity_type, 'entity_id', p_entity_id, 'action', p_action,
    'state', v_verify ->> 'state',
    'audit_id', v_audit.id,
    'decided_at', v_audit.created_at,
    'stored_hash', v_verify ->> 'stored_hash');
END;
$$;

REVOKE ALL ON FUNCTION public.hub_verify_provenance(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_verify_provenance(text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_verify_provenance(text, text, text) TO service_role;
