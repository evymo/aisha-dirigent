-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_message_log_service_all ON public.acs_message_log;
CREATE POLICY acs_message_log_service_all ON public.acs_message_log
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
