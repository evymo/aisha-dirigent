-- Index: idx_user_reminders_study
-- Table: user_reminders

CREATE INDEX idx_user_reminders_study ON public.user_reminders USING btree (study_registration_id) WHERE (study_registration_id IS NOT NULL);
