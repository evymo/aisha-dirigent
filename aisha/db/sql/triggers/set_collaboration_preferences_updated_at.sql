-- Trigger: set_collaboration_preferences_updated_at

CREATE TRIGGER set_collaboration_preferences_updated_at
  BEFORE UPDATE ON public.collaboration_preferences
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
