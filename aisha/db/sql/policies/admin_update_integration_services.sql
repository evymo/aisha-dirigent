-- Policy: admin_update_integration_services

DROP POLICY IF EXISTS "admin_update_integration_services" ON public.integration_services;
CREATE POLICY "admin_update_integration_services" ON public.integration_services
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT is_admin_or_staff()))
  WITH CHECK ((SELECT is_admin_or_staff()));
