-- Policy: staff_admin_read_events
-- Table: integration_events

DROP POLICY IF EXISTS "staff_admin_read_events" ON public.integration_events;
CREATE POLICY "staff_admin_read_events" ON public.integration_events
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
