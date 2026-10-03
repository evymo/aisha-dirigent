ALTER TABLE schema_version ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage schema version" ON schema_version;
CREATE POLICY "Admins can manage schema version" ON schema_version
  FOR ALL USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
