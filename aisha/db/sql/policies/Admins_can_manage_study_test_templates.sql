-- Policy: Admins can manage study test templates

DROP POLICY IF EXISTS "Admins can manage study test templates" ON public.study_test_templates;
CREATE POLICY "Admins can manage study test templates" ON public.study_test_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
