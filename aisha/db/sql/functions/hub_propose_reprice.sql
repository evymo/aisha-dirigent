-- ============================================================================
-- Source of Truth: hub_propose_reprice
-- Popis: Propose a reprice for an offer — composes the new price via the hamburger
--        (hub_compute_price) into a pending hub_reprice_proposal. When a story_id
--        is given, ALSO posts a typed `reprice_proposal` story_entry into that
--        story (the human gate). admin/staff/service; proactive (service) path
--        authors the entry as the connector system identity (no auth.uid()).
-- Bezpečnost: SECURITY DEFINER + REVOKE/GRANT.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.hub_propose_reprice(
  p_offer_id uuid, p_trigger text DEFAULT 'manual',
  p_context jsonb DEFAULT '{}'::jsonb, p_story_id uuid DEFAULT NULL)
RETURNS public.hub_reprice_proposal
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_offer public.hub_supplier_offer;
  v_ctx jsonb; v_priced jsonb; v_row public.hub_reprice_proposal;
BEGIN
  IF NOT (public.is_service_role())
     AND NOT public.is_admin_or_staff() THEN
    RAISE EXCEPTION 'Unauthorized: admin, staff, or service_role required';
  END IF;

  SELECT * INTO v_offer FROM public.hub_supplier_offer WHERE id = p_offer_id;
  IF v_offer.id IS NULL THEN RAISE EXCEPTION 'Unknown offer %', p_offer_id; END IF;

  v_ctx := jsonb_build_object(
    'price_buy', v_offer.price_buy, 'brand', v_offer.brand,
    'product_type', v_offer.product_type, 'category', v_offer.product_type,
    'season', v_offer.season, 'currency', v_offer.currency
  ) || COALESCE(p_context, '{}'::jsonb);

  v_priced := public.hub_compute_price(v_ctx);

  INSERT INTO public.hub_reprice_proposal
    (offer_id, trigger, context, old_price_retail, proposed_price_retail, breakdown, status, story_id, created_by)
  VALUES
    (p_offer_id, p_trigger, v_ctx, NULLIF(p_context->>'old_price_retail','')::numeric,
     (v_priced->>'price_retail')::numeric, v_priced->'breakdown', 'pending', p_story_id, auth.uid())
  RETURNING * INTO v_row;

  IF p_story_id IS NOT NULL THEN
    INSERT INTO public.story_entries
      (story_id, subject_type, subject_id, entry_type, content, metadata, created_by, occurred_at)
    VALUES
      (p_story_id, 'story', p_story_id, 'reprice_proposal',
       format('Návrh přecenění (%s): %s → %s %s', v_row.trigger,
              COALESCE(v_row.old_price_retail::text, '—'), v_row.proposed_price_retail::text,
              COALESCE(v_ctx->>'currency', public.commerce_base_currency())),
       jsonb_build_object('proposal_id', v_row.id, 'trigger', v_row.trigger, 'offer_id', p_offer_id,
         'old_price_retail', v_row.old_price_retail, 'proposed_price_retail', v_row.proposed_price_retail,
         'breakdown', v_row.breakdown,
         -- the gate state lives ON the entry (respond_to_story_block_audited stamps it,
         -- a trigger syncs hub_reprice_proposal) — mirrors metadata.flowboard.status.
         'reprice', jsonb_build_object('status', 'pending')),
       COALESCE(auth.uid(), '00000000-0000-4000-a000-00000000a070'::uuid), now());
  END IF;

  RETURN v_row;
END; $$;

REVOKE ALL ON FUNCTION public.hub_propose_reprice(uuid,text,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_propose_reprice(uuid,text,jsonb,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hub_propose_reprice(uuid,text,jsonb,uuid) TO service_role;
