-- Index: idx_hub_supplier_offer_ean

CREATE INDEX IF NOT EXISTS idx_hub_supplier_offer_ean ON public.hub_supplier_offer (ean) WHERE ean IS NOT NULL;
