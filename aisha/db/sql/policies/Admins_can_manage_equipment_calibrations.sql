-- Policy: Admins can manage equipment calibrations

DROP POLICY IF EXISTS "Admins can manage equipment calibrations" ON public.production_equipment_calibrations;
CREATE POLICY "Admins can manage equipment calibrations" ON public.production_equipment_calibrations
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
