-- Policy: admin_staff_select_integration_services

DROP POLICY IF EXISTS "admin_staff_select_integration_services" ON public.integration_services;
CREATE POLICY "admin_staff_select_integration_services" ON public.integration_services
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
