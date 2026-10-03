-- Policy: Authenticated can read cost rates

CREATE POLICY "Authenticated can read cost rates" ON public.production_cost_rates
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
