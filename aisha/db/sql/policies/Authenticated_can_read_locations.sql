-- Policy: Authenticated can read locations

CREATE POLICY "Authenticated can read locations" ON public.production_locations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
