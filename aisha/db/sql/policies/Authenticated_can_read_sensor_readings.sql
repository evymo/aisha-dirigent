-- Policy: Authenticated can read sensor readings

CREATE POLICY "Authenticated can read sensor readings" ON public.production_sensor_readings
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
