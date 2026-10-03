-- Policy: twin_entities_service
-- Source of truth pair: aisha/db/sql/tables/twin_entities.sql

CREATE POLICY twin_entities_service ON public.twin_entities
  FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');
