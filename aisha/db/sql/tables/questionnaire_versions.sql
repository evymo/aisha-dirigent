-- Table: questionnaire_versions
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS questionnaire_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  questionnaire_id uuid NOT NULL,
  version int4 NOT NULL,
  name text NOT NULL,
  name_key text,
  description_key text,
  questions jsonb NOT NULL,
  is_active bool DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  base_locale text DEFAULT 'en'::text,
  PRIMARY KEY (id),
  CONSTRAINT questionnaire_versions_questionnaire_id_fkey FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE
);

ALTER TABLE questionnaire_versions ENABLE ROW LEVEL SECURITY;
