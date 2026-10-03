-- Policy: wd_vehicle_positions_history_read
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_history.sql

DROP POLICY IF EXISTS wd_vehicle_positions_history_read ON public.wd_vehicle_positions_history;
CREATE POLICY wd_vehicle_positions_history_read ON public.wd_vehicle_positions_history
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
