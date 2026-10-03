-- Index: idx_ai_batch_jobs_last_polled
-- Stale-poll detection: jobs not polled in > poll_interval (15min) need pickup.

CREATE INDEX IF NOT EXISTS idx_ai_batch_jobs_last_polled
  ON public.ai_batch_jobs (last_polled_at NULLS FIRST)
  WHERE status IN ('submitted', 'in_progress');
