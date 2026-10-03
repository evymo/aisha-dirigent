-- Trigger: plugin_schedules_updated_at
-- Table: plugin_schedules

CREATE TRIGGER plugin_schedules_updated_at
  BEFORE UPDATE ON public.plugin_schedules
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
