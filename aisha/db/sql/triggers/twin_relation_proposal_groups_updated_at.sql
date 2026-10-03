-- Trigger: twin_relation_proposal_groups_updated_at
-- Table: twin_relation_proposal_groups

DROP TRIGGER IF EXISTS twin_relation_proposal_groups_updated_at ON public.twin_relation_proposal_groups;
CREATE TRIGGER twin_relation_proposal_groups_updated_at
  BEFORE UPDATE ON public.twin_relation_proposal_groups
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
