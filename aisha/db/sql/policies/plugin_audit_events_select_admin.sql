-- Policy: plugin_audit_events_select_admin

DROP POLICY IF EXISTS "plugin_audit_events_select_admin" ON public.plugin_audit_events;
CREATE POLICY "plugin_audit_events_select_admin" ON public.plugin_audit_events
  AS PERMISSIVE
  FOR SELECT
  TO authenticated
  USING ((SELECT is_admin_or_staff()));
