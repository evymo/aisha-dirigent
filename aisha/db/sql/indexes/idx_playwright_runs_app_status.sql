-- Index: idx_playwright_runs_app_status
-- Used by record_playwright_result + the runbook view "what is QA seeing per app".
-- Partial → only app-linked runs are interesting for slot-health correlation.

CREATE INDEX IF NOT EXISTS idx_playwright_runs_app_status
  ON public.playwright_runs (app_name, status)
  WHERE app_name IS NOT NULL;
