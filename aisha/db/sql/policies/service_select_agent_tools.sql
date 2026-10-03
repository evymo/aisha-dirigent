-- Policy: service_select_agent_tools

CREATE POLICY "service_select_agent_tools" ON public.agent_tools
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((current_setting('role'::text, true) = 'service_role'::text));
