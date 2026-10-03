-- Index: idx_user_reminders_time
-- Table: user_reminders

CREATE INDEX idx_user_reminders_time ON public.user_reminders USING btree (time_of_day);
