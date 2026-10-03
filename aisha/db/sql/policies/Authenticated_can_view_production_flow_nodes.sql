-- Policy: Authenticated can view production_flow_nodes

CREATE POLICY "Authenticated can view production_flow_nodes" ON public.production_flow_nodes
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((auth.uid() IS NOT NULL));
