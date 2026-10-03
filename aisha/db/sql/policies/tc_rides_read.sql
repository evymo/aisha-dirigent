-- Policy: tc_rides_read
-- Source of truth pair: aisha/db/sql/tables/tc_rides.sql

DROP POLICY IF EXISTS tc_rides_read ON public.tc_rides;
CREATE POLICY tc_rides_read ON public.tc_rides
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
