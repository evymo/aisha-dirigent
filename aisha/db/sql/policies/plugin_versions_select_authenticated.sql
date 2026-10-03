-- Policy: plugin_versions_select_authenticated

CREATE POLICY "plugin_versions_select_authenticated" ON public.plugin_versions
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (true);
