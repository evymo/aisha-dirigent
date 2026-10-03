-- Policy: plugin_catalog_update_admin

DROP POLICY IF EXISTS "plugin_catalog_update_admin" ON public.plugin_catalog;
CREATE POLICY "plugin_catalog_update_admin" ON public.plugin_catalog
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
