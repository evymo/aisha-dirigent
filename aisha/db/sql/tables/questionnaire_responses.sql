-- Table: questionnaire_responses
-- RLS: ENABLED

CREATE TABLE IF NOT EXISTS questionnaire_responses (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  questionnaire_id uuid NOT NULL,
  responses jsonb NOT NULL,
  score int4,
  completed_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  questionnaire_version int4,
  response_version int4 DEFAULT 1,
  supersedes_response_id uuid,
  study_registration_id uuid,
  registration_id uuid REFERENCES public.study_registrations ON DELETE SET NULL,
  PRIMARY KEY (id),
  CONSTRAINT questionnaire_responses_questionnaire_id_fkey FOREIGN KEY (questionnaire_id) REFERENCES questionnaires(id) ON DELETE CASCADE,
  CONSTRAINT questionnaire_responses_study_registration_id_fkey FOREIGN KEY (study_registration_id) REFERENCES study_registrations(id),
  CONSTRAINT questionnaire_responses_supersedes_response_id_fkey FOREIGN KEY (supersedes_response_id) REFERENCES questionnaire_responses(id),
  CONSTRAINT questionnaire_responses_user_id_fkey FOREIGN KEY (user_id) REFERENCES aisha_auth.users(id) ON DELETE CASCADE
);

ALTER TABLE questionnaire_responses ENABLE ROW LEVEL SECURITY;

-- Grants: user-owned questionnaire responses
GRANT SELECT, INSERT, UPDATE ON questionnaire_responses TO authenticated;
GRANT ALL ON questionnaire_responses TO service_role;
