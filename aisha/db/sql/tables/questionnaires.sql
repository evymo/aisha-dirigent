-- Table: questionnaires
-- Questionnaire definitions with unified translation keys.
-- Translations live in the `translations` table (namespace = 'questionnaires').
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS questionnaires (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  code text NOT NULL,
  questionnaire_type text,
  questions jsonb NOT NULL,
  is_active bool DEFAULT true,
  version int4 NOT NULL DEFAULT 1,
  name_key text,
  description_key text,
  base_locale text NOT NULL DEFAULT 'en'::text,
  points_reward int4 DEFAULT 50,
  token_reward int4 DEFAULT 25,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT questionnaires_code_key UNIQUE (code)
);

ALTER TABLE questionnaires ENABLE ROW LEVEL SECURITY;

-- Grants
GRANT SELECT ON questionnaires TO authenticated;
GRANT SELECT ON questionnaires TO anon;
GRANT ALL ON questionnaires TO service_role;
