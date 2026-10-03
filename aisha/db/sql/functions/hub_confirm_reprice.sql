-- ============================================================================
-- Source of Truth: hub_confirm_reprice
-- Popis: Confirm/reject a pending repricing proposal (the human gate in the story).
--        admin/staff. After 'confirmed' the connector applies it into the target (price_put).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627160000_hub_supplier_offer_reprice.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_confirm_reprice(p_proposal_id uuid, p_approve boolean DEFAULT true)
RETURNS public.hub_reprice_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.hub_reprice_proposal;
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized: admin or staff required'; END IF;
  UPDATE public.hub_reprice_proposal SET
    status = CASE WHEN p_approve THEN 'confirmed' ELSE 'rejected' END,
    decided_by = auth.uid(), decided_at = now(), updated_at = now()
  WHERE id = p_proposal_id AND status = 'pending'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No pending proposal %', p_proposal_id; END IF;

  -- verifiable audit (v2 blockchain_hash) — the human confirm/reject is untampered-provable.
  PERFORM public.hub_write_audit(
    'hub_reprice.' || (CASE WHEN p_approve THEN 'confirmed' ELSE 'rejected' END),
    'curation', 'content', 'info', 'Repricing proposal decision',
    'hub_reprice_proposal', p_proposal_id::text,
    jsonb_build_object('approved', p_approve,
                       'proposed_price_retail', v_row.proposed_price_retail),
    auth.uid());
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.hub_confirm_reprice(uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_confirm_reprice(uuid,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_confirm_reprice(uuid,boolean) TO service_role;
