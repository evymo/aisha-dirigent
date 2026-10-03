-- Policy: twin_events_service
-- Source of truth pair: aisha/db/sql/tables/twin_events.sql

CREATE POLICY twin_events_service ON public.twin_events
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
