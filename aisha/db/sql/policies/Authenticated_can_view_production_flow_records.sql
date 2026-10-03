-- Policy: Authenticated can view production_flow_records

CREATE POLICY "Authenticated can view production_flow_records" ON public.production_flow_records
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
