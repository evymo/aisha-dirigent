-- Policy: agent_runs_service

CREATE POLICY "agent_runs_service" ON public.agent_runs
  AS PERMISSIVE
  FOR ALL
  TO public
  USING (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
