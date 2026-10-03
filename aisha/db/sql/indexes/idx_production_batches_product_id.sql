-- Index: idx_production_batches_product_id
-- Table: production_batches

CREATE INDEX IF NOT EXISTS idx_production_batches_product_id ON public.production_batches(product_id);
