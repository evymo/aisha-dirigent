-- Policy: Admins can manage node factory requests

DROP POLICY IF EXISTS "Admins can manage node factory requests" ON public.node_factory_requests;
CREATE POLICY "Admins can manage node factory requests" ON public.node_factory_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT has_role((SELECT auth.uid()), 'admin'::text)));
