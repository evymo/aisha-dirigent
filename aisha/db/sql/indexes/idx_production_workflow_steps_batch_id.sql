-- Index: idx_production_workflow_steps_batch_id
-- Table: production_workflow_steps

CREATE INDEX IF NOT EXISTS idx_production_workflow_steps_batch_id ON public.production_workflow_steps(batch_id);
