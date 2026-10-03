-- Index: idx_chat_conversations_user_id
-- Table: chat_conversations

CREATE INDEX idx_chat_conversations_user_id ON public.chat_conversations USING btree (user_id);
