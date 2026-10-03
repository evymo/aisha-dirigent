-- Index: idx_intranet_chat_channels_type

CREATE INDEX IF NOT EXISTS idx_intranet_chat_channels_type
  ON intranet_chat_channels(channel_type) WHERE NOT is_archived;
