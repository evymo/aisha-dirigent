-- Policy: Service role full access node factory requests

CREATE POLICY "Service role full access node factory requests" ON public.node_factory_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((auth.role() = 'service_role'::text));
