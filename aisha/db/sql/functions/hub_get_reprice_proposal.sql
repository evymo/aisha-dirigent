-- ============================================================================
-- Source of Truth: hub_get_reprice_proposal
-- Popis: Read a single repricing proposal by id. The connector reads the
--        AUTHORITATIVE price (proposed_price_retail) hub-side before the target
--        price_put — it never trusts a client-supplied price. The cockpit reuses
--        it to render proposal detail. service_role/admin/staff.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627190000_hub_reprice_apply.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_get_reprice_proposal(p_id uuid)
RETURNS public.hub_reprice_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.hub_reprice_proposal;
BEGIN
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;
  SELECT * INTO v_row FROM public.hub_reprice_proposal WHERE id = p_id;
  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.hub_get_reprice_proposal(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_get_reprice_proposal(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_get_reprice_proposal(uuid) TO service_role;
