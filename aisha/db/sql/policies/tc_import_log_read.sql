-- Policy: tc_import_log_read
-- Source of truth pair: aisha/db/sql/tables/tc_import_log.sql

DROP POLICY IF EXISTS tc_import_log_read ON public.tc_import_log;
CREATE POLICY tc_import_log_read ON public.tc_import_log
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
