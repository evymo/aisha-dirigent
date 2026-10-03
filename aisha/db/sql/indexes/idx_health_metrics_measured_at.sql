-- Index: idx_health_metrics_measured_at
-- Table: health_metrics

CREATE INDEX IF NOT EXISTS idx_health_metrics_measured_at ON public.health_metrics(user_id, measured_at DESC);
