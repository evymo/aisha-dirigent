-- Policy: wd_rides_service
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql

CREATE POLICY wd_rides_service ON public.wd_rides
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
