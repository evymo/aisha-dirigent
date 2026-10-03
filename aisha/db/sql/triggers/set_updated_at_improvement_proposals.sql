-- Trigger: set_updated_at_improvement_proposals

CREATE TRIGGER set_updated_at_improvement_proposals
  BEFORE UPDATE ON public.improvement_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
