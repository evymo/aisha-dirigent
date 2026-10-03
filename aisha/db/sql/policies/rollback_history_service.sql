-- Policy: rollback_history_service

CREATE POLICY rollback_history_service ON public.rollback_history
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
