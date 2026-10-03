-- Index: idx_production_metrics_batch_id
-- Table: production_metrics

CREATE INDEX IF NOT EXISTS idx_production_metrics_batch_id ON public.production_metrics(batch_id);
