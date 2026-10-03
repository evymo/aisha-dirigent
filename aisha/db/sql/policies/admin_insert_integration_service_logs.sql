-- Policy: admin_insert_integration_service_logs

DROP POLICY IF EXISTS "admin_insert_integration_service_logs" ON public.integration_service_logs;
CREATE POLICY "admin_insert_integration_service_logs" ON public.integration_service_logs
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
