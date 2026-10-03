-- Index: idx_member_health_logs_state_id
-- Table: member_health_logs

CREATE INDEX IF NOT EXISTS idx_member_health_logs_state_id ON member_health_logs(state_id);
