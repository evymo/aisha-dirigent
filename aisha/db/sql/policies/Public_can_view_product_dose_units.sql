-- Policy: Public can view product dose units

CREATE POLICY "Public can view product dose units" ON public.product_dose_units
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING (true);
