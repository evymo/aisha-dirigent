-- Index: idx_message_escalations_message_id
-- Table: message_escalations

CREATE INDEX IF NOT EXISTS idx_message_escalations_message_id ON public.message_escalations(message_id);
