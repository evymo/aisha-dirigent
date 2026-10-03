-- Policy: agent_runs_own_select

CREATE POLICY "agent_runs_own_select" ON public.agent_runs
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((requested_by = auth.uid()));
