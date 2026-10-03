-- Index: idx_public_chat_messages_session
-- Table: public_chat_messages

CREATE INDEX IF NOT EXISTS idx_public_chat_messages_session
  ON public.public_chat_messages(session_id, created_at);
