-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_dead_letters_service_all ON public.acs_dead_letters;
CREATE POLICY acs_dead_letters_service_all ON public.acs_dead_letters
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
