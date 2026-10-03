-- Policy: wd_import_log_service
-- Source of truth pair: aisha/db/sql/tables/wd_import_log.sql

CREATE POLICY wd_import_log_service ON public.wd_import_log
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
