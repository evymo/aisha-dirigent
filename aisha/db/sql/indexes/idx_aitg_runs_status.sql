-- Index: idx_aitg_runs_status
-- Extracted from tables/aitg_runs.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_runs_status ON public.aitg_runs(status, severity)
  WHERE status IN ('failed', 'blocked');
