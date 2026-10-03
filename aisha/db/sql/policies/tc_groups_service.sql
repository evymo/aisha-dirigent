-- Policy: tc_groups_service
-- Source of truth pair: aisha/db/sql/tables/tc_groups.sql

CREATE POLICY tc_groups_service ON public.tc_groups
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
