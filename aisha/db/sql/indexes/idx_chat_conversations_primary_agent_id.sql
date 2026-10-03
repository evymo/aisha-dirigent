-- Index: idx_chat_conversations_primary_agent_id
-- Table: chat_conversations

CREATE INDEX IF NOT EXISTS idx_chat_conversations_primary_agent_id ON public.chat_conversations(primary_agent_id);
