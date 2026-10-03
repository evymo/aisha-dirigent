-- Trigger: set_session_memory_updated_at

CREATE TRIGGER set_session_memory_updated_at
  BEFORE UPDATE ON public.ai_session_memory
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
