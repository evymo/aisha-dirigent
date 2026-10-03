-- Policy: plugin_tenant_overrides_update_admin

DROP POLICY IF EXISTS "plugin_tenant_overrides_update_admin" ON public.plugin_tenant_overrides;
CREATE POLICY "plugin_tenant_overrides_update_admin" ON public.plugin_tenant_overrides
  AS PERMISSIVE
  FOR UPDATE
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
