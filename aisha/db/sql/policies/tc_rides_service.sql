-- Policy: tc_rides_service
-- Source of truth pair: aisha/db/sql/tables/tc_rides.sql

CREATE POLICY tc_rides_service ON public.tc_rides
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
