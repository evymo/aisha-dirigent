-- Trigger: update_conversation_on_message
-- Table: chat_messages

CREATE TRIGGER update_conversation_on_message
AFTER INSERT
ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION update_conversation_message_count();
