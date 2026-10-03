-- Policy: Authenticated can read deviations

CREATE POLICY "Authenticated can read deviations" ON public.production_deviations
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
