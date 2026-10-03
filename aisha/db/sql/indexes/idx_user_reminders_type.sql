-- Index: idx_user_reminders_type
-- Table: user_reminders

CREATE INDEX idx_user_reminders_type ON public.user_reminders USING btree (reminder_type);
