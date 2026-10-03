-- Index: idx_production_metrics_product_id
-- Table: production_metrics

CREATE INDEX IF NOT EXISTS idx_production_metrics_product_id ON public.production_metrics(product_id);
