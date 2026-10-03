-- Index: idx_production_logs_logged_by
-- Table: production_logs

CREATE INDEX IF NOT EXISTS idx_production_logs_logged_by ON public.production_logs(logged_by);
