ALTER TABLE product_vials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage vials" ON product_vials;
CREATE POLICY "Admins can manage vials" ON product_vials
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
