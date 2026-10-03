-- Policy: Authenticated can view production_flow_substances

CREATE POLICY "Authenticated can view production_flow_substances" ON public.production_flow_substances
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
