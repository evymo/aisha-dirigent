-- Policy: admin_staff_manage_agent_catalog

DROP POLICY IF EXISTS "admin_staff_manage_agent_catalog" ON public.agent_catalog;
CREATE POLICY "admin_staff_manage_agent_catalog" ON public.agent_catalog
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff()));
