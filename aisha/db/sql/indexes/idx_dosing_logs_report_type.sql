-- Index: idx_dosing_logs_report_type
-- Table: dosing_logs

CREATE INDEX idx_dosing_logs_report_type ON public.dosing_logs USING btree (report_type);
