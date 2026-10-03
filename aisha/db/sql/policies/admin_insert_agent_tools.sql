-- Policy: admin_insert_agent_tools

DROP POLICY IF EXISTS "admin_insert_agent_tools" ON public.agent_tools;
CREATE POLICY "admin_insert_agent_tools" ON public.agent_tools
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff()));
