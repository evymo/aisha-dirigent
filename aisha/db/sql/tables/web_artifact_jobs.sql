-- Table: web_artifact_jobs
-- Description: Lifecycle records for story-driven web artifact iterations (upload, scrape, redesign, apply)
-- RLS: ENABLED — admin/staff or story participant
-- Created: 2026-05-16

CREATE TABLE IF NOT EXISTS public.web_artifact_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  story_id uuid REFERENCES public.partner_stories(id) ON DELETE CASCADE,
  kind public.web_artifact_kind NOT NULL,
  source_type public.web_artifact_source_type NOT NULL,
  status public.web_artifact_job_status NOT NULL DEFAULT 'pending',
  source_url text,
  source_storage_path text,
  seed_canvas_data jsonb,
  result_canvas_data jsonb,
  result_canvas_html text,
  result_canvas_css text,
  extracted_tokens jsonb,
  brief text,
  slot_profile text,
  creativity_seed numeric,
  idempotency_key text NOT NULL,
  applied_to_page_id uuid REFERENCES public.web_pages(id) ON DELETE SET NULL,
  applied_version_id uuid REFERENCES public.web_page_versions(id),
  error_message text,
  created_by uuid REFERENCES aisha_auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  applied_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id),
  CONSTRAINT web_artifact_jobs_idempotency_key_unique UNIQUE (idempotency_key)
);

ALTER TABLE public.web_artifact_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.web_artifact_jobs IS 'Lifecycle records for story-driven web artifact iterations (upload, scrape, redesign, apply)';
COMMENT ON COLUMN public.web_artifact_jobs.story_id IS 'Owning story (NULL = default_seed at stack bootstrap)';
COMMENT ON COLUMN public.web_artifact_jobs.kind IS 'Lifecycle step (ingest_upload | ingest_scrape | redesign | apply)';
COMMENT ON COLUMN public.web_artifact_jobs.source_type IS 'Where artifact came from';
COMMENT ON COLUMN public.web_artifact_jobs.seed_canvas_data IS 'Input canvas — for redesign jobs, the prior canvas being iterated';
COMMENT ON COLUMN public.web_artifact_jobs.result_canvas_data IS 'Parsed/produced GrapesJS ProjectData JSON';
COMMENT ON COLUMN public.web_artifact_jobs.extracted_tokens IS 'CSS custom properties + font stacks + spacing scale detected by parser';
COMMENT ON COLUMN public.web_artifact_jobs.metadata IS 'runtime_block_suggestions[], style_band, suggested_followup_story, broken_assets[], etc.';
COMMENT ON COLUMN public.web_artifact_jobs.idempotency_key IS 'SHA-256(source_type|source_url|source_storage_path|story_id) — retry-safe';
COMMENT ON COLUMN public.web_artifact_jobs.applied_version_id IS 'Snapshot version that was current at apply time (concurrency guard)';
