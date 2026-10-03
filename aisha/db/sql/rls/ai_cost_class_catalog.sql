-- RLS: ai_cost_class_catalog
-- Source of truth pair: aisha/db/sql/tables/ai_cost_class_catalog.sql
-- Policies live in rls/ (emitted AFTER functions in the baseline) so the
-- functions they reference (is_admin_or_staff, auth.role) exist when the
-- policy binds — inline-in-table placement breaks cold-start ordering.

ALTER TABLE public.ai_cost_class_catalog ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_cost_class_catalog auth read" ON public.ai_cost_class_catalog;
CREATE POLICY "ai_cost_class_catalog auth read" ON public.ai_cost_class_catalog
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "ai_cost_class_catalog service full" ON public.ai_cost_class_catalog;
CREATE POLICY "ai_cost_class_catalog service full" ON public.ai_cost_class_catalog
  AS PERMISSIVE FOR ALL TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
