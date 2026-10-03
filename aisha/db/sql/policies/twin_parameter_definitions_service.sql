-- Policy: twin_parameter_definitions_service
-- Source of truth pair: aisha/db/sql/tables/twin_parameter_definitions.sql

CREATE POLICY twin_parameter_definitions_service ON public.twin_parameter_definitions
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
