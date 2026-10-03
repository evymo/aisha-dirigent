-- Trigger: set_updated_at_knowledge_items

CREATE TRIGGER set_updated_at_knowledge_items
  BEFORE UPDATE ON public.knowledge_items
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
