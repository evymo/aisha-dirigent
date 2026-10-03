-- Index: idx_questionnaire_responses_supersedes
-- Table: questionnaire_responses

CREATE INDEX idx_questionnaire_responses_supersedes ON public.questionnaire_responses USING btree (supersedes_response_id);
