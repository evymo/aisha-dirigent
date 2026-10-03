-- Policy: drift_state_service
-- Full access pro service_role (WF_DRIFT_OBSERVER zápis přes RPCs).

CREATE POLICY drift_state_service ON public.drift_state
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
