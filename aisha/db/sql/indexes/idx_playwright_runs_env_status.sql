-- Index: idx_playwright_runs_env_status
-- Table: playwright_runs

CREATE INDEX IF NOT EXISTS idx_playwright_runs_env_status
  ON public.playwright_runs (target_env, status);
