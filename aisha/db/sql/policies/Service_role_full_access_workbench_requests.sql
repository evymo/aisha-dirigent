-- service_role owns the workbench work queue (enqueue + poll from the central adapter).
CREATE POLICY "Service role full access workbench requests" ON public.workbench_execution_requests
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role')
  WITH CHECK ((current_setting('request.jwt.claims', true)::jsonb ->> 'role') = 'service_role');
