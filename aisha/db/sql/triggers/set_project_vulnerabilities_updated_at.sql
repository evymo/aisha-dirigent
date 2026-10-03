-- Trigger: set_project_vulnerabilities_updated_at

CREATE TRIGGER set_project_vulnerabilities_updated_at
  BEFORE UPDATE ON public.project_vulnerabilities
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
