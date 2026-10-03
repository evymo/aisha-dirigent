-- Trigger: twin_relations_updated_at
-- Table: twin_relations

DROP TRIGGER IF EXISTS twin_relations_updated_at ON public.twin_relations;
CREATE TRIGGER twin_relations_updated_at
  BEFORE UPDATE ON public.twin_relations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
