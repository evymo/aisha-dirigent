-- Index: idx_intranet_chat_members_user

CREATE INDEX IF NOT EXISTS idx_intranet_chat_members_user
  ON intranet_chat_members(user_id);
