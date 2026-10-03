-- Policy: tc_groups_read
-- Source of truth pair: aisha/db/sql/tables/tc_groups.sql

DROP POLICY IF EXISTS tc_groups_read ON public.tc_groups;
CREATE POLICY tc_groups_read ON public.tc_groups
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
