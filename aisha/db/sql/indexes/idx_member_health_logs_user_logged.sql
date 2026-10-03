-- Index: idx_member_health_logs_user_logged
-- Table: member_health_logs

CREATE INDEX IF NOT EXISTS idx_member_health_logs_user_logged ON member_health_logs(user_id, logged_at DESC);
