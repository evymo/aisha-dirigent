-- Index: idx_health_metrics_source
-- Table: health_metrics

CREATE INDEX IF NOT EXISTS idx_health_metrics_source ON public.health_metrics(source, source_id);
