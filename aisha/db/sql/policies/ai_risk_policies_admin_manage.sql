-- Policy: ai_risk_policies_admin_manage
-- Table: ai_risk_policies
-- Source-of-truth pair: aisha/db/sql/tables/ai_risk_policies.sql
--                       aisha/db/sql/rls/ai_risk_policies.sql (ENABLE ROW LEVEL SECURITY)
--
-- Governance is POLICY, not a maintained allow-list. Who may manage risk
-- thresholds is DERIVED from the caller's admin/staff role via the existing
-- (SELECT is_admin_or_staff()) auth guard — there is no array or row of permitted
-- names to maintain. Adding/removing a manager is a membership change in
-- aisha_auth, never an edit here. Lives in policies/ (emitted AFTER functions
-- in the baseline) so (SELECT is_admin_or_staff()) exists when the policy binds.

DROP POLICY IF EXISTS "ai_risk_policies_admin_manage" ON public.ai_risk_policies;
CREATE POLICY "ai_risk_policies_admin_manage" ON public.ai_risk_policies
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
