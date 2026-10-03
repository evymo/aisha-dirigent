-- Policy: plugin_tenant_overrides_insert_admin

DROP POLICY IF EXISTS "plugin_tenant_overrides_insert_admin" ON public.plugin_tenant_overrides;
CREATE POLICY "plugin_tenant_overrides_insert_admin" ON public.plugin_tenant_overrides
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT is_admin_or_staff()));
