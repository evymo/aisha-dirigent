-- Policy: plugin_catalog_select_authenticated

CREATE POLICY "plugin_catalog_select_authenticated" ON public.plugin_catalog
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((status = ANY (ARRAY['canary'::plugin_status, 'ga'::plugin_status])));
