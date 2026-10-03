-- Index: idx_dosing_logs_user_id
-- Table: dosing_logs

CREATE INDEX idx_dosing_logs_user_id ON public.dosing_logs USING btree (user_id);
