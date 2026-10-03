-- Index: idx_tc_import_log_type_started
-- Source of truth pair: aisha/db/sql/tables/tc_import_log.sql

CREATE INDEX idx_tc_import_log_type_started ON public.tc_import_log (import_type, started_at DESC);
