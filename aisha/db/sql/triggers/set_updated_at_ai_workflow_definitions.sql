-- Trigger: set_updated_at_ai_workflow_definitions

CREATE TRIGGER set_updated_at_ai_workflow_definitions
  BEFORE UPDATE ON public.ai_workflow_definitions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
