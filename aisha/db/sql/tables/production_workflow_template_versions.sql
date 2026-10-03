-- Table: public.production_workflow_template_versions
-- Description: Version history for production workflow templates. Every save creates a version snapshot.
-- Source: Migration 20260219180000_production_enhancements.sql

CREATE TABLE IF NOT EXISTS public.production_workflow_template_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.production_workflow_templates(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  version_label text,
  workflow_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  workflow_steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_summary text,
  created_by uuid REFERENCES aisha_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT uq_template_version UNIQUE (template_id, version_number)
);

ALTER TABLE public.production_workflow_template_versions ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT ON public.production_workflow_template_versions TO authenticated;
