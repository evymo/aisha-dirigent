-- Policy: admin_update_agent_tools

DROP POLICY IF EXISTS "admin_update_agent_tools" ON public.agent_tools;
CREATE POLICY "admin_update_agent_tools" ON public.agent_tools
  AS PERMISSIVE
  FOR UPDATE
  TO public
  USING ((SELECT is_admin_or_staff()));
