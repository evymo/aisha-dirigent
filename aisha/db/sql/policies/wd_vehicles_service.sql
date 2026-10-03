-- Policy: wd_vehicles_service
-- Source of truth pair: aisha/db/sql/tables/wd_vehicles.sql

CREATE POLICY wd_vehicles_service ON public.wd_vehicles
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
