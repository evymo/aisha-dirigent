-- Policy: plugin_versions_update_admin

DROP POLICY IF EXISTS "plugin_versions_update_admin" ON public.plugin_versions;
CREATE POLICY "plugin_versions_update_admin" ON public.plugin_versions
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
