-- ============================================================================
-- Source of Truth: hub_supplier_offer
-- Popis: Connector Hub — supplier price-catalog offers (EDI/PRICAT target).
--        price_buy + stock per supplier SKU. Spravováno: EDI ingest (service).
-- Pár: aisha/db/migrations/20260627160000_hub_supplier_offer_reprice.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.hub_supplier_offer (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id     uuid        NOT NULL REFERENCES public.hub_source(id) ON DELETE CASCADE,
  supplier_sku  text        NOT NULL,
  ean           text,
  product_type  text,
  brand         text,
  title         text,
  size          text,
  season        text,
  price_buy     numeric,
  -- currency has NO column DEFAULT on purpose: a DEFAULT commerce_base_currency()
  -- would be a forward-reference in the generated baseline (which emits all tables
  -- before all functions). The sole writer hub_upsert_supplier_offer resolves it via
  -- COALESCE(payload currency, commerce_base_currency()), so the value is never null.
  currency      text        NOT NULL,
  stock_qty     integer,
  warehouse     text,
  valid_from    date,
  snapshot_token text,
  refreshed_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_id, supplier_sku)
);

COMMENT ON TABLE public.hub_supplier_offer IS 'Connector Hub: supplier price-catalog offers (EDI/PRICAT target). price_buy + stock per supplier SKU.';

ALTER TABLE public.hub_supplier_offer ENABLE ROW LEVEL SECURITY;
