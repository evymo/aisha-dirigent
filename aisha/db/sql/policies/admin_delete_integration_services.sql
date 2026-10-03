-- Policy: admin_delete_integration_services

DROP POLICY IF EXISTS "admin_delete_integration_services" ON public.integration_services;
CREATE POLICY "admin_delete_integration_services" ON public.integration_services
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT is_admin_or_staff()));
