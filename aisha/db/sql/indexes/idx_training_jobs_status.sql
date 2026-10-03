-- Index: idx_training_jobs_status
-- Auto-extracted from table SoT

CREATE INDEX IF NOT EXISTS idx_training_jobs_status ON public.training_jobs(status);
