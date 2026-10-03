-- Index: idx_production_milestones_batch_id
-- Table: production_milestones

CREATE INDEX IF NOT EXISTS idx_production_milestones_batch_id ON public.production_milestones(batch_id);
