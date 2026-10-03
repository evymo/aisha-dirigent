-- Trigger: set_github_app_installations_updated_at

CREATE TRIGGER set_github_app_installations_updated_at
  BEFORE UPDATE ON public.github_app_installations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
