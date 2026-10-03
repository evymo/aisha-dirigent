-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS obligation_register_service_all ON public.obligation_register;
CREATE POLICY obligation_register_service_all ON public.obligation_register
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
