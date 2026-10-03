-- Policy: Plugin Schedules: admin/staff full access

DROP POLICY IF EXISTS "Plugin Schedules: admin/staff full access" ON public.plugin_schedules;
CREATE POLICY "Plugin Schedules: admin/staff full access" ON public.plugin_schedules
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
