-- Policy: wd_drivers_service
-- Source of truth pair: aisha/db/sql/tables/wd_drivers.sql

CREATE POLICY wd_drivers_service ON public.wd_drivers
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
