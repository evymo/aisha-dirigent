-- Index: idx_production_batches_approved_by
-- Table: production_batches

CREATE INDEX IF NOT EXISTS idx_production_batches_approved_by ON public.production_batches(approved_by);
