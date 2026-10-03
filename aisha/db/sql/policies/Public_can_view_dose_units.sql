-- Policy: Public can view dose units

CREATE POLICY "Public can view dose units" ON public.dose_units
  AS PERMISSIVE
  FOR SELECT
  TO anon, authenticated
  USING ((is_active = true));
