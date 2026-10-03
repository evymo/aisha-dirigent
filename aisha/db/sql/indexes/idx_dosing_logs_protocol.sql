-- Index: idx_dosing_logs_protocol
-- Table: dosing_logs

CREATE INDEX idx_dosing_logs_protocol ON public.dosing_logs USING btree (distribution_protocol_id);
