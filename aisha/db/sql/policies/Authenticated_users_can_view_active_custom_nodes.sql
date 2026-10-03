-- Policy: Authenticated users can view active custom nodes

CREATE POLICY "Authenticated users can view active custom nodes" ON public.custom_node_registry
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING (((auth.role() = 'authenticated'::text) AND (is_active = true)));
