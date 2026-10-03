-- Index: idx_intranet_chat_messages_channel_created

CREATE INDEX IF NOT EXISTS idx_intranet_chat_messages_channel_created
  ON intranet_chat_messages(channel_id, created_at DESC);
