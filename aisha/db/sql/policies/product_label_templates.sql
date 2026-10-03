ALTER TABLE product_label_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage label templates" ON product_label_templates;
CREATE POLICY "Admins can manage label templates" ON product_label_templates
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
