-- ============================================================================
-- Source of Truth: hub_apply_reprice
-- Popis: Apply a CONFIRMED repricing proposal into the target — the final stage of
--        the cenotvorba loop. The connector service does the target's
--        price_put FIRST, then calls this to record applied + post a typed
--        `reprice_applied` story_entry (the operator sees the resolution in the
--        story they confirmed in). Gated on status='confirmed'. service_role/admin/staff.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627190000_hub_reprice_apply.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_apply_reprice(
  p_proposal_id uuid, p_applied_ref jsonb DEFAULT '{}'::jsonb, p_applied_by uuid DEFAULT NULL)
RETURNS public.hub_reprice_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_row public.hub_reprice_proposal; v_actor uuid; v_audit_actor uuid;
BEGIN
  -- service_role (the connector, AFTER the human gate) OR admin/staff (direct).
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  v_actor := COALESCE(p_applied_by, auth.uid());

  -- ONLY a confirmed proposal may be applied (not pending, not rejected, not re-applied).
  UPDATE public.hub_reprice_proposal SET
    status = 'applied', applied_by = v_actor, applied_at = now(),
    applied_ref = COALESCE(p_applied_ref, '{}'::jsonb), updated_at = now()
  WHERE id = p_proposal_id AND status = 'confirmed'
  RETURNING * INTO v_row;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'No confirmed proposal to apply %', p_proposal_id; END IF;

  -- Audit must never block a real operation: the target write already landed, so an
  -- actor absent from aisha_auth.users (e.g. an admin whose JIT row was never
  -- provisioned) must NOT roll the apply back on the audit FK. Null it for the audit
  -- only (applied_by has no FK, so it keeps the true operator id for provenance).
  v_audit_actor := v_actor;
  IF v_audit_actor IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM aisha_auth.users u WHERE u.id = v_audit_actor) THEN
    v_audit_actor := NULL;
  END IF;

  -- verifiable audit (v2 blockchain_hash) — dealer can prove this apply is untampered.
  PERFORM public.hub_write_audit(
    'hub_reprice.applied', 'curation', 'content', 'info',
    'Repricing proposal applied into the target',
    'hub_reprice_proposal', p_proposal_id::text,
    jsonb_build_object('proposed_price_retail', v_row.proposed_price_retail,
                       'applied_ref', COALESCE(p_applied_ref, '{}'::jsonb)),
    v_audit_actor);

  -- The operator sees the resolution in the same story they confirmed in.
  IF v_row.story_id IS NOT NULL THEN
    INSERT INTO public.story_entries
      (story_id, subject_type, subject_id, entry_type, content, metadata, created_by, occurred_at)
    VALUES
      (v_row.story_id, 'story', v_row.story_id, 'reprice_applied',
       format('Cena aplikována do cílového systému: %s %s', v_row.proposed_price_retail::text,
              COALESCE(v_row.context->>'currency', public.commerce_base_currency())),
       jsonb_build_object('proposal_id', v_row.id, 'proposed_price_retail', v_row.proposed_price_retail,
         'applied_ref', COALESCE(p_applied_ref, '{}'::jsonb)),
       COALESCE(v_actor, '00000000-0000-4000-a000-00000000a070'::uuid), now());
  END IF;

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.hub_apply_reprice(uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_apply_reprice(uuid,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_apply_reprice(uuid,jsonb,uuid) TO service_role;
