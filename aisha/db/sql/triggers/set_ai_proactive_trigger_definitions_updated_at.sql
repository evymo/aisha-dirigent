-- Trigger: set_ai_proactive_trigger_definitions_updated_at

CREATE TRIGGER set_ai_proactive_trigger_definitions_updated_at
  BEFORE UPDATE ON public.ai_proactive_trigger_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
