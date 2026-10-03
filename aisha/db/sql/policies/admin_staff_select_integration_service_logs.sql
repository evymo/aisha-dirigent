-- Policy: admin_staff_select_integration_service_logs

DROP POLICY IF EXISTS "admin_staff_select_integration_service_logs" ON public.integration_service_logs;
CREATE POLICY "admin_staff_select_integration_service_logs" ON public.integration_service_logs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
