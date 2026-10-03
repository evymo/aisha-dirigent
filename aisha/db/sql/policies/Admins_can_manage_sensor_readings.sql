-- Policy: Admins can manage sensor readings

DROP POLICY IF EXISTS "Admins can manage sensor readings" ON public.production_sensor_readings;
CREATE POLICY "Admins can manage sensor readings" ON public.production_sensor_readings
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
