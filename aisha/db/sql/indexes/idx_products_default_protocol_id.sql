-- Index: idx_products_default_protocol_id
-- Table: products

CREATE INDEX IF NOT EXISTS idx_products_default_protocol_id ON public.products(default_protocol_id);
