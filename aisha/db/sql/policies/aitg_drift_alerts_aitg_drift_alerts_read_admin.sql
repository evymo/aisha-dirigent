-- Policy: aitg_drift_alerts_read_admin ON public.aitg_drift_alerts
-- Auto-extracted (back-port reconciliation)

DROP POLICY IF EXISTS "aitg_drift_alerts_read_admin" ON public.aitg_drift_alerts;
CREATE POLICY "aitg_drift_alerts_read_admin" ON public.aitg_drift_alerts AS PERMISSIVE FOR SELECT TO authenticated USING ((SELECT is_admin_or_staff()));
