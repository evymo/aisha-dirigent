-- Index: idx_reminder_completions_user_date
-- Table: reminder_completions

CREATE INDEX idx_reminder_completions_user_date ON public.reminder_completions USING btree (user_id, completed_at DESC);
