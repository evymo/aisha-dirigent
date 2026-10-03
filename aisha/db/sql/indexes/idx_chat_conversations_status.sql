-- Index: idx_chat_conversations_status
-- Table: chat_conversations

CREATE INDEX idx_chat_conversations_status ON public.chat_conversations USING btree (status);
