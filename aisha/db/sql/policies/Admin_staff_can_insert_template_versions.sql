-- Policy: Admin/staff can insert template versions

DROP POLICY IF EXISTS "Admin/staff can insert template versions" ON public.production_workflow_template_versions;
CREATE POLICY "Admin/staff can insert template versions" ON public.production_workflow_template_versions
  AS PERMISSIVE
  FOR INSERT
  TO public
  WITH CHECK ((SELECT is_admin_or_staff((SELECT auth.uid()))));
