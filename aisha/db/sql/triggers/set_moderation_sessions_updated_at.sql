-- Trigger: set_moderation_sessions_updated_at

CREATE TRIGGER set_moderation_sessions_updated_at
  BEFORE UPDATE ON public.moderation_sessions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
