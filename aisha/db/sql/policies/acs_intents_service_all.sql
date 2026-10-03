-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_intents_service_all ON public.acs_intents;
CREATE POLICY acs_intents_service_all ON public.acs_intents
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
