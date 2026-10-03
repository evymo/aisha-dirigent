-- Index: idx_production_metrics_study_id
-- Table: production_metrics

CREATE INDEX IF NOT EXISTS idx_production_metrics_study_id ON public.production_metrics(study_id);
