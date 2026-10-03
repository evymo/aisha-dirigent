-- RLS: agent_phase_catalog
-- Source of truth pair: aisha/db/sql/tables/agent_phase_catalog.sql
-- Policies live in rls/ (emitted AFTER functions in the baseline) so the
-- functions they reference (is_admin_or_staff, auth.role) exist when the
-- policy binds — inline-in-table placement breaks cold-start ordering.

ALTER TABLE public.agent_phase_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_phase_catalog auth read" ON public.agent_phase_catalog;
CREATE POLICY "agent_phase_catalog auth read" ON public.agent_phase_catalog
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "agent_phase_catalog service full" ON public.agent_phase_catalog;
CREATE POLICY "agent_phase_catalog service full" ON public.agent_phase_catalog
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
