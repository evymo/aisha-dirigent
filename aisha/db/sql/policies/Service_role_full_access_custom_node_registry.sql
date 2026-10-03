-- Policy: Service role full access custom node registry

CREATE POLICY "Service role full access custom node registry" ON public.custom_node_registry
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));
