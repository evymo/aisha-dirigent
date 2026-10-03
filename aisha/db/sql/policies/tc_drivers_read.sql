-- Policy: tc_drivers_read
-- Source of truth pair: aisha/db/sql/tables/tc_drivers.sql

DROP POLICY IF EXISTS tc_drivers_read ON public.tc_drivers;
CREATE POLICY tc_drivers_read ON public.tc_drivers
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
