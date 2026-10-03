-- Index: idx_study_questionnaires_questionnaire
-- Table: study_questionnaires

CREATE INDEX idx_study_questionnaires_questionnaire ON public.study_questionnaires USING btree (questionnaire_id);
