-- Policy: plugin_versions_insert_admin

DROP POLICY IF EXISTS "plugin_versions_insert_admin" ON public.plugin_versions;
CREATE POLICY "plugin_versions_insert_admin" ON public.plugin_versions
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT is_admin_or_staff()));
