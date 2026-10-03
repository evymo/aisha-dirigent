-- Index: idx_member_wearable_connections_user_id
-- Table: member_wearable_connections

CREATE INDEX IF NOT EXISTS idx_member_wearable_connections_user_id
  ON member_wearable_connections (user_id);

-- Index for finding active connections
