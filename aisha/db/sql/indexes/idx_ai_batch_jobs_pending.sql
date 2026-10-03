-- Index: idx_ai_batch_jobs_pending
-- Polling index: pending jobs ordered by oldest first (FIFO).

CREATE INDEX IF NOT EXISTS idx_ai_batch_jobs_pending
  ON public.ai_batch_jobs (status, submitted_at)
  WHERE status IN ('submitted', 'in_progress');
