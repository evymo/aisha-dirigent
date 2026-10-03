-- Trigger: set_updated_at_ai_model_registry

CREATE TRIGGER set_updated_at_ai_model_registry
  BEFORE UPDATE ON public.ai_model_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
