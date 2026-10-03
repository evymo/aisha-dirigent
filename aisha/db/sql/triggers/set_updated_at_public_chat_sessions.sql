-- Trigger: set_updated_at_public_chat_sessions
-- Table: public_chat_sessions

CREATE TRIGGER set_updated_at_public_chat_sessions
  BEFORE UPDATE ON public.public_chat_sessions
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
