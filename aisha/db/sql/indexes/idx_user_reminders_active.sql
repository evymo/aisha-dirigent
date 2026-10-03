-- Index: idx_user_reminders_active
-- Table: user_reminders

CREATE INDEX idx_user_reminders_active ON public.user_reminders USING btree (user_id, is_active) WHERE (is_active = true);
