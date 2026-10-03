ALTER TABLE study_test_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage study test templates" ON study_test_templates;
CREATE POLICY "Admins can manage study test templates" ON study_test_templates
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
