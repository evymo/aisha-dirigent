-- Policy: Authenticated can read cost scenarios

CREATE POLICY "Authenticated can read cost scenarios" ON public.production_cost_scenarios
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.role() = 'authenticated'::text));
