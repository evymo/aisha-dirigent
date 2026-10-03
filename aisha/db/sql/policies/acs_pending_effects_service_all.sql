-- Policy: service_role plný přístup (zápisy výhradně přes audited RPC).

DROP POLICY IF EXISTS acs_pending_effects_service_all ON public.acs_pending_effects;
CREATE POLICY acs_pending_effects_service_all ON public.acs_pending_effects
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
