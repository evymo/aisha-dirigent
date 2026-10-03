-- Policy: hub_import_job_read

DROP POLICY IF EXISTS hub_import_job_read ON public.hub_import_job;
CREATE POLICY hub_import_job_read ON public.hub_import_job
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
