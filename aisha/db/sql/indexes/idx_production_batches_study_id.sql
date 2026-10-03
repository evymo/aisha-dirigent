-- Index: idx_production_batches_study_id
-- Table: production_batches

CREATE INDEX IF NOT EXISTS idx_production_batches_study_id ON public.production_batches(study_id);
