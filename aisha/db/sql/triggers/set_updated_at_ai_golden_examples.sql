-- Trigger: set_updated_at_ai_golden_examples

CREATE TRIGGER set_updated_at_ai_golden_examples
  BEFORE UPDATE ON public.ai_golden_examples
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
