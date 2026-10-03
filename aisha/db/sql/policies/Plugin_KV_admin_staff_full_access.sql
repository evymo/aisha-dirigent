-- Policy: Plugin KV: admin/staff full access

DROP POLICY IF EXISTS "Plugin KV: admin/staff full access" ON public.plugin_kv;
CREATE POLICY "Plugin KV: admin/staff full access" ON public.plugin_kv
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
