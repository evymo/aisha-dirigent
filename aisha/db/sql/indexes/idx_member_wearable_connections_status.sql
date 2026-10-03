-- Index: idx_member_wearable_connections_status
-- Table: member_wearable_connections

CREATE INDEX IF NOT EXISTS idx_member_wearable_connections_status
  ON member_wearable_connections (user_id, connection_status)
  WHERE connection_status = 'connected';
