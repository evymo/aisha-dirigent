-- Policies: project_presets
-- Extracted from tables/project_presets.sql for source separation compliance

DROP POLICY IF EXISTS "Anyone authenticated can read presets" ON public.project_presets;
CREATE POLICY "Anyone authenticated can read presets"
  ON public.project_presets FOR SELECT
  TO authenticated
  USING (is_active = true);

DROP POLICY IF EXISTS "Admin/staff can manage presets" ON public.project_presets;
CREATE POLICY "Admin/staff can manage presets"
  ON public.project_presets FOR ALL
  TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
