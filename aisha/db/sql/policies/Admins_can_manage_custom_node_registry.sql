-- Policy: Admins can manage custom node registry

DROP POLICY IF EXISTS "Admins can manage custom node registry" ON public.custom_node_registry;
CREATE POLICY "Admins can manage custom node registry" ON public.custom_node_registry
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
