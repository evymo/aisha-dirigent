-- Policy: twin_relation_proposal_groups_read — čtení skupin návrhů (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_relation_proposal_groups.sql
--
-- Rozhodovat o vazbách je práce správce — týž nárok jako twin_relations_read
-- a fronta identit (get_twin_ref_review_block). Širší publikum návrhy nevidí:
-- návrh není fakt a nemá co dělat v pohledu člověka, který o něm nerozhoduje.
--
-- Predikát v poddotazu → InitPlan (jedno vyhodnocení za dotaz, ne per řádek).
DROP POLICY IF EXISTS twin_relation_proposal_groups_read ON public.twin_relation_proposal_groups;
CREATE POLICY twin_relation_proposal_groups_read ON public.twin_relation_proposal_groups
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
