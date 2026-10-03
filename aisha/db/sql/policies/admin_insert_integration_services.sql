-- Policy: admin_insert_integration_services

DROP POLICY IF EXISTS "admin_insert_integration_services" ON public.integration_services;
CREATE POLICY "admin_insert_integration_services" ON public.integration_services
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
