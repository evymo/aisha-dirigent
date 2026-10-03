-- Policy: service_role_manage_events
-- Table: integration_events

CREATE POLICY "service_role_manage_events" ON public.integration_events
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
