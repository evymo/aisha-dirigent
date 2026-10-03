-- Index: idx_aitg_runs_recent
-- Extracted from tables/aitg_runs.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_runs_recent ON public.aitg_runs(test_id, finished_at DESC);
