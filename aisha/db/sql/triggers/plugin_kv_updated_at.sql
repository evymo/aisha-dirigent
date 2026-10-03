-- Trigger: plugin_kv_updated_at
-- Table: plugin_kv

CREATE TRIGGER plugin_kv_updated_at
  BEFORE UPDATE ON public.plugin_kv
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
