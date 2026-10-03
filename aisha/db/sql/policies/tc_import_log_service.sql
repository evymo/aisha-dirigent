-- Policy: tc_import_log_service
-- Source of truth pair: aisha/db/sql/tables/tc_import_log.sql

CREATE POLICY tc_import_log_service ON public.tc_import_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
