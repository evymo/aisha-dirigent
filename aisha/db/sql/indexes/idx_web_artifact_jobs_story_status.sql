-- Index: idx_web_artifact_jobs_story_status
-- Table: web_artifact_jobs
-- Composite (story_id, status) — supports the "list jobs for a story filtered
-- by status" query path used by web-artifact ingest workflows + admin UI.

CREATE INDEX IF NOT EXISTS idx_web_artifact_jobs_story_status
  ON public.web_artifact_jobs (story_id, status);
