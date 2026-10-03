-- Policy: Admin/staff can manage sensor alerts

DROP POLICY IF EXISTS "Admin/staff can manage sensor alerts" ON public.production_sensor_alerts;
CREATE POLICY "Admin/staff can manage sensor alerts" ON public.production_sensor_alerts
  AS PERMISSIVE
  FOR ALL
  TO public
  USING ((SELECT is_admin_or_staff((SELECT auth.uid()))));
