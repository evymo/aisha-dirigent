-- Trigger: set_sentry_monitor_config_updated_at

CREATE TRIGGER set_sentry_monitor_config_updated_at
  BEFORE UPDATE ON public.sentry_monitor_config
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
