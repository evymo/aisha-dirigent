-- Index: idx_playwright_runs_created_at
-- Table: playwright_runs

CREATE INDEX IF NOT EXISTS idx_playwright_runs_created_at
  ON public.playwright_runs (created_at DESC);
