-- Index: idx_web_artifact_jobs_created_at
-- Table: web_artifact_jobs
-- DESC order — supports the recency-first listing used by admin job
-- timelines and the ingest queue dashboard.

CREATE INDEX IF NOT EXISTS idx_web_artifact_jobs_created_at
  ON public.web_artifact_jobs (created_at DESC);
