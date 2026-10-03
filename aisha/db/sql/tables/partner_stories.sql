-- Table: partner_stories
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS partner_stories (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  partner_id uuid,
  user_id uuid REFERENCES aisha_auth.users ON DELETE SET NULL,
  is_stack_default boolean NOT NULL DEFAULT false,
  study_id uuid,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'inbox'::text,
  priority text NOT NULL DEFAULT 'normal'::text,
  is_starred bool NOT NULL DEFAULT false,
  is_read bool NOT NULL DEFAULT false,
  unread_count int4 NOT NULL DEFAULT 0,
  last_activity_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  repo_url text,
  repo_provider text,
  default_branch text,
  github_installation_id bigint,
  delivery_status text,
  tech_stack text[],
  risk_profile text,
  domain text[],
  project_preview jsonb NOT NULL DEFAULT '{"summary":"","goals":[],"constraints":[],"success_criteria":[],"meta":{}}'::jsonb,
  origin text DEFAULT 'manual'::text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  canvas_data jsonb,
  canvas_html text,
  canvas_css text,
  PRIMARY KEY (id),
  CONSTRAINT partner_stories_project_preview_shape_check CHECK (
    jsonb_typeof(project_preview) = 'object'
    AND project_preview ? 'summary'
    AND project_preview ? 'goals'
    AND project_preview ? 'constraints'
    AND project_preview ? 'success_criteria'
    AND jsonb_typeof(project_preview->'summary') = 'string'
    AND jsonb_typeof(project_preview->'goals') = 'array'
    AND jsonb_typeof(project_preview->'constraints') = 'array'
    AND jsonb_typeof(project_preview->'success_criteria') = 'array'
  ),
  CONSTRAINT partner_stories_partner_id_fkey FOREIGN KEY (partner_id) REFERENCES partner_profiles(id) ON DELETE CASCADE,
  CONSTRAINT partner_stories_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE SET NULL
);

ALTER TABLE partner_stories ENABLE ROW LEVEL SECURITY;
