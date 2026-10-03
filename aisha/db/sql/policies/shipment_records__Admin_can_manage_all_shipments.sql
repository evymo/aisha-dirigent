-- Policy: Admin can manage all shipments

DROP POLICY IF EXISTS "Admin can manage all shipments" ON public.shipment_records;
CREATE POLICY "Admin can manage all shipments" ON public.shipment_records
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
