-- Index: idx_health_metrics_registration_id
-- Table: health_metrics

CREATE INDEX IF NOT EXISTS idx_health_metrics_registration_id ON public.health_metrics(study_registration_id);
