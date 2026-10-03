-- Trigger: trg_improvement_proposals_updated_at

CREATE TRIGGER trg_improvement_proposals_updated_at
  BEFORE UPDATE ON public.improvement_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
