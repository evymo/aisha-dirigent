-- Policy: Admin can manage shipment settings

DROP POLICY IF EXISTS "Admin can manage shipment settings" ON public.shipment_settings;
CREATE POLICY "Admin can manage shipment settings" ON public.shipment_settings
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
