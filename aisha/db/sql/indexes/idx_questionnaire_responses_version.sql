-- Index: idx_questionnaire_responses_version
-- Table: questionnaire_responses

CREATE INDEX idx_questionnaire_responses_version ON public.questionnaire_responses USING btree (questionnaire_id, questionnaire_version);
