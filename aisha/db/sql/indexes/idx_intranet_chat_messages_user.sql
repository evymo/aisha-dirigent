-- Index: idx_intranet_chat_messages_user

CREATE INDEX IF NOT EXISTS idx_intranet_chat_messages_user
  ON intranet_chat_messages(user_id);
