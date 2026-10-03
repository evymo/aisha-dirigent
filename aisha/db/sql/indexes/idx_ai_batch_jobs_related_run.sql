-- Index: idx_ai_batch_jobs_related_run
-- Lookup by related_run_id (for ai_runs ↔ batch_job back-references).

CREATE INDEX IF NOT EXISTS idx_ai_batch_jobs_related_run
  ON public.ai_batch_jobs (related_run_id)
  WHERE related_run_id IS NOT NULL;
