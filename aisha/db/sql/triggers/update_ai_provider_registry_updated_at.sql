-- Trigger: update_ai_provider_registry_updated_at
-- Maintains updated_at on ai_provider_registry row mutations (Phase 2D provider catalog).

CREATE TRIGGER update_ai_provider_registry_updated_at
  BEFORE UPDATE ON public.ai_provider_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
