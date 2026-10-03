-- Policy: twin_external_refs_service
-- Source of truth pair: aisha/db/sql/tables/twin_external_refs.sql

CREATE POLICY twin_external_refs_service ON public.twin_external_refs
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
