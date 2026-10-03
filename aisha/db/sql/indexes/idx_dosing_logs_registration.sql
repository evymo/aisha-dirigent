-- Index: idx_dosing_logs_registration
-- Table: dosing_logs

CREATE INDEX idx_dosing_logs_registration ON public.dosing_logs USING btree (study_registration_id) WHERE (study_registration_id IS NOT NULL);
