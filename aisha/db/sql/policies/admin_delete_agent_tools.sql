-- Policy: admin_delete_agent_tools

DROP POLICY IF EXISTS "admin_delete_agent_tools" ON public.agent_tools;
CREATE POLICY "admin_delete_agent_tools" ON public.agent_tools
  AS PERMISSIVE
  FOR DELETE
  TO public
  USING ((SELECT is_admin_or_staff()));
