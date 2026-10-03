-- Index: idx_reminder_completions_health_check_in_id
-- Table: reminder_completions

CREATE INDEX IF NOT EXISTS idx_reminder_completions_health_check_in_id ON public.reminder_completions(health_check_in_id);
