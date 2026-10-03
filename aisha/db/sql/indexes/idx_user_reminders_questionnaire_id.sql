-- Index: idx_user_reminders_questionnaire_id
-- Table: user_reminders

CREATE INDEX IF NOT EXISTS idx_user_reminders_questionnaire_id ON public.user_reminders(questionnaire_id);
