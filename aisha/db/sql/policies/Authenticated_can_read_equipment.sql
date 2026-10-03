-- Policy: Authenticated can read equipment

CREATE POLICY "Authenticated can read equipment" ON public.production_equipment
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
