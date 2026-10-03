-- Policy: tc_vehicles_service
-- Source of truth pair: aisha/db/sql/tables/tc_vehicles.sql

CREATE POLICY tc_vehicles_service ON public.tc_vehicles
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
