-- Index: idx_wd_import_log_running
-- Source of truth pair: aisha/db/sql/tables/wd_import_log.sql

CREATE INDEX idx_wd_import_log_running
  ON public.wd_import_log (started_at)
  WHERE status = 'running';
