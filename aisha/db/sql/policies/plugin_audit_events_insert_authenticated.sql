-- Policy: plugin_audit_events_insert_authenticated

CREATE POLICY "plugin_audit_events_insert_authenticated" ON public.plugin_audit_events
  AS PERMISSIVE
  FOR INSERT
  TO authenticated
  WITH CHECK (true);
