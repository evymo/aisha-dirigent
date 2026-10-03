-- Policy: wd_vehicle_positions_current_read
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_current.sql

DROP POLICY IF EXISTS wd_vehicle_positions_current_read ON public.wd_vehicle_positions_current;
CREATE POLICY wd_vehicle_positions_current_read ON public.wd_vehicle_positions_current
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
