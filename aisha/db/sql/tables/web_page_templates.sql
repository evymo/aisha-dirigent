-- Table: web_page_templates
-- Purpose: Reusable page builder templates that can be applied to web_pages.

CREATE TABLE IF NOT EXISTS public.web_page_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  canvas_data jsonb NOT NULL,
  canvas_html text,
  canvas_css text,
  page_settings jsonb DEFAULT '{}'::jsonb,
  thumbnail_url text,
  created_by uuid REFERENCES aisha_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (id)
);

ALTER TABLE public.web_page_templates ENABLE ROW LEVEL SECURITY;
