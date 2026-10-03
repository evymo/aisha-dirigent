-- Policy: default deny — čtení jen admin/staff (governance surface), ne plošně authenticated.

DROP POLICY IF EXISTS agent_knowledge_sources_admin_select ON public.agent_knowledge_sources;
CREATE POLICY agent_knowledge_sources_admin_select ON public.agent_knowledge_sources
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
