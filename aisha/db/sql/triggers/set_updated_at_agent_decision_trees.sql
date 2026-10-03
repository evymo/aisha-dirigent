-- Trigger: set_updated_at_agent_decision_trees

CREATE TRIGGER set_updated_at_agent_decision_trees
  BEFORE UPDATE ON public.agent_decision_trees
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
