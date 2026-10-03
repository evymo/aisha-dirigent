-- Trigger: twin_relation_proposals_updated_at
-- Table: twin_relation_proposals

DROP TRIGGER IF EXISTS twin_relation_proposals_updated_at ON public.twin_relation_proposals;
CREATE TRIGGER twin_relation_proposals_updated_at
  BEFORE UPDATE ON public.twin_relation_proposals
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
