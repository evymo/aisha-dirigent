-- Policy: service_role plný přístup (zápisy výhradně přes audited li_upsert_* RPC).

DROP POLICY IF EXISTS li_source_registry_service_all ON public.li_source_registry;
CREATE POLICY li_source_registry_service_all ON public.li_source_registry
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
