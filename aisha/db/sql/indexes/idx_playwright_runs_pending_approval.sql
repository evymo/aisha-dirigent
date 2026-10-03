-- Index: idx_playwright_runs_pending_approval
-- Table: playwright_runs

CREATE INDEX IF NOT EXISTS idx_playwright_runs_pending_approval
  ON public.playwright_runs (status)
  WHERE approval_required = true AND approved_at IS NULL;
