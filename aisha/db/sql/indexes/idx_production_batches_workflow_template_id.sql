-- Index: idx_production_batches_workflow_template_id
-- Table: production_batches

CREATE INDEX IF NOT EXISTS idx_production_batches_workflow_template_id ON public.production_batches(workflow_template_id);
