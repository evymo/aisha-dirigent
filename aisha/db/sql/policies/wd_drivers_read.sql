-- Policy: wd_drivers_read
-- Source of truth pair: aisha/db/sql/tables/wd_drivers.sql

DROP POLICY IF EXISTS wd_drivers_read ON public.wd_drivers;
CREATE POLICY wd_drivers_read ON public.wd_drivers
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
