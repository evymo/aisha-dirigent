-- Policy: Admins can manage locations

DROP POLICY IF EXISTS "Admins can manage locations" ON public.production_locations;
CREATE POLICY "Admins can manage locations" ON public.production_locations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
