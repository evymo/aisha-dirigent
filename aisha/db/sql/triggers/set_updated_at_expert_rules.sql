-- Trigger: set_updated_at_expert_rules

CREATE TRIGGER set_updated_at_expert_rules
  BEFORE UPDATE ON public.expert_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
