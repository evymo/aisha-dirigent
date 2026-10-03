-- Trigger: set_updated_at_expert_rule_ratings

CREATE TRIGGER set_updated_at_expert_rule_ratings
  BEFORE UPDATE ON public.expert_rule_ratings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
