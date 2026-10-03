-- Policy: hub_import_job_service

DROP POLICY IF EXISTS hub_import_job_service ON public.hub_import_job;
CREATE POLICY hub_import_job_service ON public.hub_import_job
  FOR ALL USING ((auth.jwt() ->> 'role') = 'service_role')
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');
