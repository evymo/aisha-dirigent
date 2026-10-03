-- Policy: plugin_catalog_insert_admin

DROP POLICY IF EXISTS "plugin_catalog_insert_admin" ON public.plugin_catalog;
CREATE POLICY "plugin_catalog_insert_admin" ON public.plugin_catalog
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT is_admin_or_staff()));
