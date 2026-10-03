-- Policy: jen service_role (platformní dopočet vektorů + měření pokrytí).
-- Source of truth pair: aisha/db/sql/tables/knowledge_embedding_vynechani.sql

DROP POLICY IF EXISTS knowledge_embedding_vynechani_service_all ON public.knowledge_embedding_vynechani;
CREATE POLICY knowledge_embedding_vynechani_service_all ON public.knowledge_embedding_vynechani
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);
