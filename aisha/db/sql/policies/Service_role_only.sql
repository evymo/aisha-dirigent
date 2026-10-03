-- Policy: Service role only

CREATE POLICY "Service role only" ON public.call_events
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
