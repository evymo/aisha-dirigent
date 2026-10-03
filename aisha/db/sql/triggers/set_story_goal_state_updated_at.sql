-- Trigger: set_story_goal_state_updated_at
-- Table: story_goal_state

CREATE TRIGGER set_story_goal_state_updated_at
  BEFORE UPDATE ON public.story_goal_state
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
