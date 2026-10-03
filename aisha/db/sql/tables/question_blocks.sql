-- Table: question_blocks
-- Reusable question building blocks with unified translation keys.
-- Translations live in the `translations` table (namespace = 'questionnaires').
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS question_blocks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  question_type text NOT NULL,
  is_required_default bool NOT NULL DEFAULT false,
  text_key text NOT NULL,
  description_key text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  base_locale text NOT NULL DEFAULT 'en'::text,
  is_active bool NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  context_type text,
  questions jsonb DEFAULT '[]'::jsonb,
  sort_order int4 DEFAULT 0,
  display_order int4 DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT question_blocks_code_key UNIQUE (code),
  CONSTRAINT question_blocks_created_by_fkey FOREIGN KEY (created_by) REFERENCES aisha_auth.users(id)
);

ALTER TABLE question_blocks ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON question_blocks TO authenticated;
GRANT SELECT ON question_blocks TO anon;
GRANT ALL ON question_blocks TO service_role;
