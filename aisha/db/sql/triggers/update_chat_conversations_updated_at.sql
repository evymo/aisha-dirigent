-- Trigger: update_chat_conversations_updated_at
-- Table: chat_conversations

CREATE TRIGGER update_chat_conversations_updated_at
BEFORE UPDATE
ON public.chat_conversations
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();
