-- Policies: public.production_sensor_alerts
-- Source: Migration 20260219180000_production_enhancements.sql

DROP POLICY IF EXISTS "Admin/staff can manage sensor alerts" ON public.production_sensor_alerts;
CREATE POLICY "Admin/staff can manage sensor alerts"
  ON public.production_sensor_alerts
  FOR ALL USING ((SELECT public.is_admin_or_staff((SELECT auth.uid()))));
