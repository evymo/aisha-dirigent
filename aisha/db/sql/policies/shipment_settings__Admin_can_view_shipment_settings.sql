-- Policy: Admin can view shipment settings

DROP POLICY IF EXISTS "Admin can view shipment settings" ON public.shipment_settings;
CREATE POLICY "Admin can view shipment settings" ON public.shipment_settings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
