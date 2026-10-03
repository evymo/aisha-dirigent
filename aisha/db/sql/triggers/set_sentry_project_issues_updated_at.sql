-- Trigger: set_sentry_project_issues_updated_at

CREATE TRIGGER set_sentry_project_issues_updated_at
  BEFORE UPDATE ON public.sentry_project_issues
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
