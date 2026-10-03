-- Index: idx_reminder_completions_questionnaire_response_id
-- Table: reminder_completions

CREATE INDEX IF NOT EXISTS idx_reminder_completions_questionnaire_response_id ON public.reminder_completions(questionnaire_response_id);
