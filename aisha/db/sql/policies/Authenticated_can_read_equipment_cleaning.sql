-- Policy: Authenticated can read equipment cleaning

CREATE POLICY "Authenticated can read equipment cleaning" ON public.production_equipment_cleaning
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
