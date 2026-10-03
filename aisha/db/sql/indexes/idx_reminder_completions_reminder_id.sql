-- Index: idx_reminder_completions_reminder_id
-- Table: reminder_completions

CREATE INDEX idx_reminder_completions_reminder_id ON public.reminder_completions USING btree (reminder_id);
