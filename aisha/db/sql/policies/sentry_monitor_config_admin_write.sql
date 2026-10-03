-- Policy: sentry_monitor_config_admin_write
-- Table: sentry_monitor_config

DROP POLICY IF EXISTS sentry_monitor_config_admin_write ON public.sentry_monitor_config;
CREATE POLICY sentry_monitor_config_admin_write ON public.sentry_monitor_config
  FOR ALL TO authenticated
  USING ((SELECT public.is_admin_or_staff()))
  WITH CHECK ((SELECT public.is_admin_or_staff()));
