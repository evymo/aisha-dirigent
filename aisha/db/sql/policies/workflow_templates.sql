ALTER TABLE workflow_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage workflow templates" ON workflow_templates;
CREATE POLICY "Admins can manage workflow templates" ON workflow_templates
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
