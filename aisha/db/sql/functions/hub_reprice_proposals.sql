-- ============================================================================
-- Source of Truth: hub_reprice_proposals
-- Popis: List repricing proposals (by status) for the cockpit / story. admin/staff.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627160000_hub_supplier_offer_reprice.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_reprice_proposals(p_status text DEFAULT 'pending', p_limit int DEFAULT 100)
RETURNS SETOF hub_reprice_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.is_admin_or_staff() THEN RAISE EXCEPTION 'Unauthorized: admin or staff required'; END IF;
  RETURN QUERY
    SELECT id, offer_id, "trigger", context, old_price_retail, proposed_price_retail, breakdown, status, story_id, created_by, decided_by, decided_at, applied_by, applied_at, applied_ref, created_at, updated_at FROM public.hub_reprice_proposal
    WHERE p_status IS NULL OR status = p_status
    ORDER BY created_at DESC LIMIT GREATEST(p_limit,1);
END; $$;

REVOKE ALL ON FUNCTION public.hub_reprice_proposals(text,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_reprice_proposals(text,int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_reprice_proposals(text,int) TO service_role;
