-- Policy: Admins and staff can view all node factory requests

DROP POLICY IF EXISTS "Admins and staff can view all node factory requests" ON public.node_factory_requests;
CREATE POLICY "Admins and staff can view all node factory requests" ON public.node_factory_requests
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
