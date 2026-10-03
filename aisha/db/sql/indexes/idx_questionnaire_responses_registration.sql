-- Index: idx_questionnaire_responses_registration
-- Table: questionnaire_responses

CREATE INDEX idx_questionnaire_responses_registration ON public.questionnaire_responses USING btree (study_registration_id) WHERE (study_registration_id IS NOT NULL);
