-- Index: idx_questionnaire_versions_unique
-- Table: questionnaire_versions

CREATE UNIQUE INDEX idx_questionnaire_versions_unique ON public.questionnaire_versions USING btree (questionnaire_id, version);
