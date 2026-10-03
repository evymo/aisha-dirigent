-- Table: web_page_versions
-- Purpose: Snapshot history of web pages (auto + manual versioning).

CREATE TABLE IF NOT EXISTS public.web_page_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES public.web_pages(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  canvas_data jsonb NOT NULL,
  canvas_html text,
  canvas_css text,
  page_settings jsonb DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES aisha_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  label text,
  PRIMARY KEY (id)
);

ALTER TABLE public.web_page_versions ENABLE ROW LEVEL SECURITY;
