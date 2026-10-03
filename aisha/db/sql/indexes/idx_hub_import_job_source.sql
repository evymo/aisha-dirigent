-- Index: idx_hub_import_job_source

CREATE INDEX IF NOT EXISTS idx_hub_import_job_source ON public.hub_import_job (source_id, started_at DESC);
