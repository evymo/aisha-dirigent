-- Trigger: set_story_environments_updated_at

CREATE TRIGGER set_story_environments_updated_at
  BEFORE UPDATE ON public.story_environments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
