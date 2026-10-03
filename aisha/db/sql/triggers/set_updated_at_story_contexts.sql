-- Trigger: set_updated_at_story_contexts

CREATE TRIGGER set_updated_at_story_contexts
  BEFORE UPDATE ON public.story_contexts
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
