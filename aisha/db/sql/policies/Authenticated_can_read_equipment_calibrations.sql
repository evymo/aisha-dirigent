-- Policy: Authenticated can read equipment calibrations

CREATE POLICY "Authenticated can read equipment calibrations" ON public.production_equipment_calibrations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
