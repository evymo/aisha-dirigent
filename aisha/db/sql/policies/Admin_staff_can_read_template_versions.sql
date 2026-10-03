-- Policy: Admin/staff can read template versions

DROP POLICY IF EXISTS "Admin/staff can read template versions" ON public.production_workflow_template_versions;
CREATE POLICY "Admin/staff can read template versions" ON public.production_workflow_template_versions
  AS PERMISSIVE
  FOR SELECT
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
