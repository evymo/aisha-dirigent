-- ============================================================================
-- Source of Truth: hub_run_reprice_sweep
-- Popis: Proactive reprice orchestrator — the n8n trigger's single entrypoint.
--        Iterates the priced supplier offers, proposes a reprice for each
--        (hub_propose_reprice) into the target story (defaults to stack-default),
--        audits, returns {trigger, proposed, story_id}. service_role/admin/staff.
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- Pár: aisha/db/migrations/20260627180000_hub_reprice_sweep.sql
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_run_reprice_sweep(
  p_trigger text DEFAULT 'manual', p_story_id uuid DEFAULT NULL, p_context jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE v_story uuid; v_offer record; v_count int := 0;
BEGIN
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  v_story := p_story_id;
  IF v_story IS NULL THEN
    SELECT id INTO v_story FROM public.partner_stories WHERE is_stack_default = true ORDER BY created_at LIMIT 1;
  END IF;

  FOR v_offer IN SELECT id FROM public.hub_supplier_offer WHERE price_buy IS NOT NULL ORDER BY updated_at DESC LOOP
    PERFORM public.hub_propose_reprice(v_offer.id, p_trigger, COALESCE(p_context, '{}'::jsonb), v_story);
    v_count := v_count + 1;
  END LOOP;

  -- verifiable audit (v2 blockchain_hash) — the proactive sweep run is untampered-provable.
  PERFORM public.hub_write_audit(
    'hub_reprice_sweep.run', 'automation', 'content', 'info',
    format('Reprice sweep (%s): %s proposals', p_trigger, v_count),
    'hub_reprice_sweep', v_story::text,
    jsonb_build_object('trigger', p_trigger, 'proposed', v_count, 'story_id', v_story),
    NULL);

  RETURN jsonb_build_object('trigger', p_trigger, 'proposed', v_count, 'story_id', v_story);
END; $$;

REVOKE ALL ON FUNCTION public.hub_run_reprice_sweep(text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_run_reprice_sweep(text,uuid,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_run_reprice_sweep(text,uuid,jsonb) TO service_role;
