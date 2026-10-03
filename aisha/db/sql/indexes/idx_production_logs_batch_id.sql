-- Index: idx_production_logs_batch_id
-- Table: production_logs

CREATE INDEX IF NOT EXISTS idx_production_logs_batch_id ON public.production_logs(batch_id);
