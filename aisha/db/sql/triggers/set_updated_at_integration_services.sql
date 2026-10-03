-- Trigger: set_updated_at_integration_services

CREATE TRIGGER set_updated_at_integration_services
  BEFORE UPDATE ON public.integration_services
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
