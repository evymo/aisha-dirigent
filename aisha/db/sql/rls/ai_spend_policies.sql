-- RLS: ai_spend_policies
-- Source of truth pair: aisha/db/sql/tables/ai_spend_policies.sql
-- Policies live in rls/ (emitted AFTER functions in the baseline) so the
-- functions they reference (is_admin_or_staff, auth.role) exist when the
-- policy binds — inline-in-table placement breaks cold-start ordering.

ALTER TABLE public.ai_spend_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_spend_policies admin read" ON public.ai_spend_policies;
CREATE POLICY "ai_spend_policies admin read" ON public.ai_spend_policies
  AS PERMISSIVE FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff((SELECT auth.uid()))));

DROP POLICY IF EXISTS "ai_spend_policies service full" ON public.ai_spend_policies;
CREATE POLICY "ai_spend_policies service full" ON public.ai_spend_policies
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
