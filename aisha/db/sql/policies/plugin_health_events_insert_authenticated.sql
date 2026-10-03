-- Policy: plugin_health_events_insert_authenticated

CREATE POLICY "plugin_health_events_insert_authenticated" ON public.plugin_health_events
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
