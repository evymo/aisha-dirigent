-- Index: idx_aitg_runs_build
-- Extracted from tables/aitg_runs.sql (SQL source separation policy)

CREATE INDEX IF NOT EXISTS idx_aitg_runs_build  ON public.aitg_runs(build_sha, test_id);
