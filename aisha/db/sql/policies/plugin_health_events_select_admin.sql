-- Policy: plugin_health_events_select_admin

DROP POLICY IF EXISTS "plugin_health_events_select_admin" ON public.plugin_health_events;
CREATE POLICY "plugin_health_events_select_admin" ON public.plugin_health_events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
