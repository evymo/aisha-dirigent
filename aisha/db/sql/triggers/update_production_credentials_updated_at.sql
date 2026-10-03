-- Trigger: update_production_credentials_updated_at

CREATE TRIGGER update_production_credentials_updated_at
  BEFORE UPDATE ON public.production_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
