-- Policy: wd_vehicle_positions_current_service
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_current.sql

CREATE POLICY wd_vehicle_positions_current_service ON public.wd_vehicle_positions_current
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
