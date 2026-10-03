-- Policy: Admins can manage workflow templates

DROP POLICY IF EXISTS "Admins can manage workflow templates" ON public.workflow_templates;
CREATE POLICY "Admins can manage workflow templates" ON public.workflow_templates
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
