-- Policy: twin_relation_proposals_read — čtení návrhů hran (admin/staff)
-- Source of truth pair: aisha/db/sql/tables/twin_relation_proposals.sql
--
-- Zrcadlí twin_relation_proposal_groups_read; zápis jen přes definer RPC
-- (twin_relation_propose / twin_relation_proposal_decide), bez write policy.
-- Predikát v poddotazu → InitPlan.
DROP POLICY IF EXISTS twin_relation_proposals_read ON public.twin_relation_proposals;
CREATE POLICY twin_relation_proposals_read ON public.twin_relation_proposals
  FOR SELECT USING ((SELECT public.is_admin_or_staff()));
