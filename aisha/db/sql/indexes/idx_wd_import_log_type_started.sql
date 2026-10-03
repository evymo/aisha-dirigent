-- Index: idx_wd_import_log_type_started
-- Source of truth pair: aisha/db/sql/tables/wd_import_log.sql

CREATE INDEX idx_wd_import_log_type_started
  ON public.wd_import_log (import_type, started_at DESC);
