-- Index: idx_questionnaire_responses_user_questionnaire
-- Table: questionnaire_responses

CREATE INDEX idx_questionnaire_responses_user_questionnaire ON public.questionnaire_responses USING btree (user_id, questionnaire_id, completed_at DESC);
