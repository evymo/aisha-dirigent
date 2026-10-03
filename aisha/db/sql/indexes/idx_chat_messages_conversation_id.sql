-- Index: idx_chat_messages_conversation_id
-- Table: chat_messages

CREATE INDEX idx_chat_messages_conversation_id ON public.chat_messages USING btree (conversation_id);
