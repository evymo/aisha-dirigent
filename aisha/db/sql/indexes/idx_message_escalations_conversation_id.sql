-- Index: idx_message_escalations_conversation_id
-- Table: message_escalations

CREATE INDEX IF NOT EXISTS idx_message_escalations_conversation_id ON public.message_escalations(conversation_id);
