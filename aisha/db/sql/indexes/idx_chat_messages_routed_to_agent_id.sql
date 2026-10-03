-- Index: idx_chat_messages_routed_to_agent_id
-- Table: chat_messages

CREATE INDEX IF NOT EXISTS idx_chat_messages_routed_to_agent_id ON public.chat_messages(routed_to_agent_id);
