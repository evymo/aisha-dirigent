-- Index: idx_web_artifact_jobs_applied_page
-- Table: web_artifact_jobs
-- Partial — only rows with a non-null applied_to_page_id. Supports "which job
-- produced this page" lookups without scanning the (typically large) tail of
-- jobs that never got applied.

CREATE INDEX IF NOT EXISTS idx_web_artifact_jobs_applied_page
  ON public.web_artifact_jobs (applied_to_page_id)
  WHERE applied_to_page_id IS NOT NULL;
