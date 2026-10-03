-- ============================================================================
-- Source of Truth: hub_verify_reprice_provenance
-- Popis: Dealer-facing provenance check for a repricing proposal — thin wrapper
--        over the generic hub_verify_provenance, keyed by the proposal id. Kept as
--        a stable name for the Cenotvorba cockpit (verifyProvenance query). Returns
--        { proposal_id, state, audit_id, decided_at, stored_hash }; state='no_audit'
--        when not yet applied. Gated admin/staff OR service_role (inherited).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_verify_reprice_provenance(
  p_proposal_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v jsonb;
BEGIN
  v := public.hub_verify_provenance('hub_reprice_proposal', p_proposal_id::text, 'hub_reprice.applied');
  RETURN jsonb_build_object(
    'proposal_id', p_proposal_id,
    'state',       v ->> 'state',
    'audit_id',    v -> 'audit_id',
    'decided_at',  v -> 'decided_at',
    'stored_hash', v ->> 'stored_hash');
END;
$$;

REVOKE ALL ON FUNCTION public.hub_verify_reprice_provenance(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_verify_reprice_provenance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_verify_reprice_provenance(uuid) TO service_role;
