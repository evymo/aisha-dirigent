-- Trigger: set_updated_at_public_chat_channels
-- Table: public_chat_channels

CREATE TRIGGER set_updated_at_public_chat_channels
  BEFORE UPDATE ON public.public_chat_channels
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
