-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_agent_acl_service_all ON public.acs_agent_acl;
CREATE POLICY acs_agent_acl_service_all ON public.acs_agent_acl
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
