-- Policy: sentry_monitor_config_admin_read
-- Table: sentry_monitor_config

DROP POLICY IF EXISTS sentry_monitor_config_admin_read ON public.sentry_monitor_config;
CREATE POLICY sentry_monitor_config_admin_read ON public.sentry_monitor_config
  FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_or_staff()));
