-- Trigger: set_updated_at_project_presets
-- Extracted from tables/project_presets.sql for source separation compliance

CREATE TRIGGER set_updated_at_project_presets
  BEFORE UPDATE ON public.project_presets
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
