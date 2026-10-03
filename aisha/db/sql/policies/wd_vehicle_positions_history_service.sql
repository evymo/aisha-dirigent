-- Policy: wd_vehicle_positions_history_service
-- Source of truth pair: aisha/db/sql/tables/wd_vehicle_positions_history.sql

CREATE POLICY wd_vehicle_positions_history_service ON public.wd_vehicle_positions_history
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
