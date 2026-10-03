-- Policy: Admins can manage preferences

DROP POLICY IF EXISTS "Admins can manage preferences" ON public.user_shipment_preferences;
CREATE POLICY "Admins can manage preferences" ON public.user_shipment_preferences
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
