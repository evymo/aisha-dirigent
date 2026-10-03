-- Policy: Authenticated can read coefficients

CREATE POLICY "Authenticated can read coefficients" ON public.production_coefficients
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
