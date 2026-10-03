-- Policy: wd_vehicles_read
-- Source of truth pair: aisha/db/sql/tables/wd_vehicles.sql

DROP POLICY IF EXISTS wd_vehicles_read ON public.wd_vehicles;
CREATE POLICY wd_vehicles_read ON public.wd_vehicles
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
