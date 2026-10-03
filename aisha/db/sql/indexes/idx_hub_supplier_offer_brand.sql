-- Index: idx_hub_supplier_offer_brand

CREATE INDEX IF NOT EXISTS idx_hub_supplier_offer_brand ON public.hub_supplier_offer (brand, product_type);
