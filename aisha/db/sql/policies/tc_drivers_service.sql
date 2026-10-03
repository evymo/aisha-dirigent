-- Policy: tc_drivers_service
-- Source of truth pair: aisha/db/sql/tables/tc_drivers.sql

CREATE POLICY tc_drivers_service ON public.tc_drivers
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
