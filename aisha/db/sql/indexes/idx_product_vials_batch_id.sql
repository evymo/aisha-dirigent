-- Index: idx_product_vials_batch_id
-- Table: product_vials

CREATE INDEX IF NOT EXISTS idx_product_vials_batch_id ON public.product_vials(batch_id);
