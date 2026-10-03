-- Policy: plugin_catalog_select_admin

DROP POLICY IF EXISTS "plugin_catalog_select_admin" ON public.plugin_catalog;
CREATE POLICY "plugin_catalog_select_admin" ON public.plugin_catalog
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
