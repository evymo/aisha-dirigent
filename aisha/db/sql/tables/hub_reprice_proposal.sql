-- ============================================================================
-- Source of Truth: hub_reprice_proposal
-- Popis: Connector Hub — a repricing proposal. AISHA composes it (hamburger);
--        it lives IN A STORY; the responsible person confirms; then applied into
--        the target (price_put). Spravováno: AISHA/connector (propose) + operator.
-- Pár: aisha/db/migrations/20260627160000_hub_supplier_offer_reprice.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_reprice_proposal (
  id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id              uuid        REFERENCES public.hub_supplier_offer(id) ON DELETE CASCADE,
  trigger               text        NOT NULL DEFAULT 'manual',
  context               jsonb       NOT NULL DEFAULT '{}'::jsonb,
  old_price_retail      numeric,
  proposed_price_retail numeric,
  breakdown             jsonb,
  status                text        NOT NULL DEFAULT 'pending'
                          CONSTRAINT hub_reprice_proposal_status_chk
                          CHECK (status IN ('pending', 'confirmed', 'rejected', 'applied')),
  story_id              uuid        REFERENCES public.partner_stories(id) ON DELETE SET NULL,
  created_by            uuid,
  decided_by            uuid,
  decided_at            timestamptz,
  applied_by            uuid,
  applied_at            timestamptz,
  applied_ref           jsonb,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.hub_reprice_proposal IS 'Connector Hub: a repricing proposal (AISHA proposes via hamburger; lives in a story; operator confirms; then applied into the target).';

ALTER TABLE public.hub_reprice_proposal ENABLE ROW LEVEL SECURITY;
