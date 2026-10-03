-- Policy: plugin_tenant_overrides_select_own

DROP POLICY IF EXISTS "plugin_tenant_overrides_select_own" ON public.plugin_tenant_overrides;
CREATE POLICY "plugin_tenant_overrides_select_own" ON public.plugin_tenant_overrides
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING (((tenant_id = auth.uid()) OR (SELECT is_admin_or_staff())));
