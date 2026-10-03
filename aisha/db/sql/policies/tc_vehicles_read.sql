-- Policy: tc_vehicles_read
-- Source of truth pair: aisha/db/sql/tables/tc_vehicles.sql

DROP POLICY IF EXISTS tc_vehicles_read ON public.tc_vehicles;
CREATE POLICY tc_vehicles_read ON public.tc_vehicles
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
