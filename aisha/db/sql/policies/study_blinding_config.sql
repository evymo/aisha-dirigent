ALTER TABLE study_blinding_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage blinding config" ON study_blinding_config;
CREATE POLICY "Admins can manage blinding config" ON study_blinding_config
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
