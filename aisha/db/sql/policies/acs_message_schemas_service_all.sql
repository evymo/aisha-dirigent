-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_message_schemas_service_all ON public.acs_message_schemas;
CREATE POLICY acs_message_schemas_service_all ON public.acs_message_schemas
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
