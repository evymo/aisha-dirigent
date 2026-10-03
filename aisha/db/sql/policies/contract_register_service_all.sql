-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS contract_register_service_all ON public.contract_register;
CREATE POLICY contract_register_service_all ON public.contract_register
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
