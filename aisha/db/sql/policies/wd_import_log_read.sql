-- Policy: wd_import_log_read
-- Source of truth pair: aisha/db/sql/tables/wd_import_log.sql

DROP POLICY IF EXISTS wd_import_log_read ON public.wd_import_log;
CREATE POLICY wd_import_log_read ON public.wd_import_log
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
