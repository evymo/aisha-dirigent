-- Index: idx_distribution_protocols_product_id
-- Table: distribution_protocols

CREATE INDEX IF NOT EXISTS idx_distribution_protocols_product_id ON public.distribution_protocols(product_id);
