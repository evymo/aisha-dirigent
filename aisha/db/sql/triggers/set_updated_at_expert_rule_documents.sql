-- Trigger: set_updated_at_expert_rule_documents

CREATE TRIGGER set_updated_at_expert_rule_documents
  BEFORE UPDATE ON public.expert_rule_documents
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
