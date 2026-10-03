-- Trigger: trg_plugin_tenant_overrides_updated_at
-- Table: plugin_tenant_overrides

CREATE TRIGGER trg_plugin_tenant_overrides_updated_at
  BEFORE UPDATE ON public.plugin_tenant_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
