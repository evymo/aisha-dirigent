-- Index: idx_public_chat_sessions_channel
-- Table: public_chat_sessions

CREATE INDEX IF NOT EXISTS idx_public_chat_sessions_channel
  ON public.public_chat_sessions(channel_id, status);
