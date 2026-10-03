-- Index: idx_intranet_chat_members_channel

CREATE INDEX IF NOT EXISTS idx_intranet_chat_members_channel
  ON intranet_chat_members(channel_id);
