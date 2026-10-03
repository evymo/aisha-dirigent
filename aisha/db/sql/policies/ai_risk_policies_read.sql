-- RLS: ai_risk_policies (read)
-- Source of truth pair: aisha/db/sql/tables/ai_risk_policies.sql
-- Policies live in policies/ (emitted AFTER functions in the baseline) so the
-- functions they reference (is_admin_or_staff, auth.role) exist when the policy
-- binds — inline-in-table placement breaks cold-start ordering.
--
-- Governance model (capability-availability, NOT an allow-list):
-- ai_risk_policies holds risk THRESHOLDS for the execution decision (criticality
-- / side-effect class → threshold → allow/ask/deny). This file only governs WHO
-- may READ those policy rows. Visibility is DERIVED from the caller's role via
-- (SELECT is_admin_or_staff()) (looks up user_roles) — there is no maintained list of
-- permitted names anywhere in this file.

ALTER TABLE public.ai_risk_policies ENABLE ROW LEVEL SECURITY;

-- Admin/staff may read risk policies. (SELECT is_admin_or_staff()) resolves the current
-- user from auth.uid() via its DEFAULT NULL argument, so the no-arg form is the
-- intended call shape for RLS predicates.
DROP POLICY IF EXISTS "ai_risk_policies admin read" ON public.ai_risk_policies;
CREATE POLICY "ai_risk_policies admin read" ON public.ai_risk_policies
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT is_admin_or_staff()));

-- service_role retains full access for the SECURITY INVOKER seed/runtime chain
-- that reads and maintains risk thresholds during boot and execution decisions.
DROP POLICY IF EXISTS "ai_risk_policies service full" ON public.ai_risk_policies;
CREATE POLICY "ai_risk_policies service full" ON public.ai_risk_policies
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
