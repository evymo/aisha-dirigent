-- Index: idx_production_workflow_steps_completed_by
-- Table: production_workflow_steps

CREATE INDEX IF NOT EXISTS idx_production_workflow_steps_completed_by ON public.production_workflow_steps(completed_by);
