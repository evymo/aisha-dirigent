-- Policy: admin_staff_select_agent_tools

DROP POLICY IF EXISTS "admin_staff_select_agent_tools" ON public.agent_tools;
CREATE POLICY "admin_staff_select_agent_tools" ON public.agent_tools
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff()));
