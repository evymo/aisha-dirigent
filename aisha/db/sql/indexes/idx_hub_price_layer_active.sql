-- Index: idx_hub_price_layer_active

CREATE INDEX IF NOT EXISTS idx_hub_price_layer_active ON public.hub_price_layer (sort_order) WHERE is_active;
