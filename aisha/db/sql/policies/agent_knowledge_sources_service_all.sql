-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS agent_knowledge_sources_service_all ON public.agent_knowledge_sources;
CREATE POLICY agent_knowledge_sources_service_all ON public.agent_knowledge_sources
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
