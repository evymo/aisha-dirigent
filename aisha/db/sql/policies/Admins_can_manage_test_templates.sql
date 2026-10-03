-- Policy: Admins can manage test templates

DROP POLICY IF EXISTS "Admins can manage test templates" ON public.test_templates;
CREATE POLICY "Admins can manage test templates" ON public.test_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
