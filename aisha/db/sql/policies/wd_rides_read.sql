-- Policy: wd_rides_read
-- Source of truth pair: aisha/db/sql/tables/wd_rides.sql

DROP POLICY IF EXISTS wd_rides_read ON public.wd_rides;
CREATE POLICY wd_rides_read ON public.wd_rides
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
