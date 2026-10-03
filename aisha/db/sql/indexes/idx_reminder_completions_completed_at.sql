-- Index: idx_reminder_completions_completed_at
-- Table: reminder_completions

CREATE INDEX idx_reminder_completions_completed_at ON public.reminder_completions USING btree (completed_at DESC);
