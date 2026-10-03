-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS document_registry_service_all ON public.document_registry;
CREATE POLICY document_registry_service_all ON public.document_registry
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
