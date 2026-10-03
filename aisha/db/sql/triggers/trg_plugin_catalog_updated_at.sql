-- Trigger: trg_plugin_catalog_updated_at
-- Table: plugin_catalog

CREATE TRIGGER trg_plugin_catalog_updated_at
  BEFORE UPDATE ON public.plugin_catalog
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
