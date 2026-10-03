-- Table: study_questionnaires
-- Links questionnaires to studies with scheduling configuration.
-- Translations live in the `translations` table (namespace = 'questionnaires').
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS study_questionnaires (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  study_id uuid NOT NULL,
  questionnaire_type text NOT NULL,
  questionnaire_id uuid,
  title_key text,
  description_key text,
  frequency_type text DEFAULT 'one_time'::text,
  frequency_days int4,
  starts_after_days int4 DEFAULT 0,
  ends_after_days int4,
  is_required bool NOT NULL DEFAULT true,
  is_active bool NOT NULL DEFAULT true,
  display_order int4 NOT NULL DEFAULT 0,
  token_reward int4 DEFAULT 25,
  questionnaire_version int4 DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  CONSTRAINT study_questionnaires_study_id_questionnaire_type_key UNIQUE (study_id, questionnaire_type),
  CONSTRAINT study_questionnaires_questionnaire_id_fkey FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE SET NULL,
  CONSTRAINT study_questionnaires_study_id_fkey FOREIGN KEY (study_id) REFERENCES studies(id) ON DELETE CASCADE
);

ALTER TABLE study_questionnaires ENABLE ROW LEVEL SECURITY;
