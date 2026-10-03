-- Trigger: set_aisha_tooling_proposals_updated_at

CREATE TRIGGER set_aisha_tooling_proposals_updated_at
  BEFORE UPDATE ON public.aisha_tooling_proposals
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
