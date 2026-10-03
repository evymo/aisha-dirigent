-- Index: idx_dosing_logs_study_id
-- Table: dosing_logs

CREATE INDEX IF NOT EXISTS idx_dosing_logs_study_id ON public.dosing_logs(study_id);
