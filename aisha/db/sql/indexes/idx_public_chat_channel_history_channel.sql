-- Index: idx_public_chat_channel_history_channel
-- Table: public_chat_channel_history

CREATE INDEX IF NOT EXISTS idx_public_chat_channel_history_channel
  ON public.public_chat_channel_history(channel_id, version DESC);
