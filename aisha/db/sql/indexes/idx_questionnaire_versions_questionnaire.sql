-- Index: idx_questionnaire_versions_questionnaire
-- Table: questionnaire_versions

CREATE INDEX idx_questionnaire_versions_questionnaire ON public.questionnaire_versions USING btree (questionnaire_id);
