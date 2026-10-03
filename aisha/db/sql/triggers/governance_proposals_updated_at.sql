-- Trigger: governance_proposals_updated_at
-- Table: governance_proposals

CREATE TRIGGER governance_proposals_updated_at
  BEFORE UPDATE ON public.governance_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
