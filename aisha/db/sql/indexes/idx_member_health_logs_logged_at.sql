-- Index: idx_member_health_logs_logged_at
-- Table: member_health_logs

CREATE INDEX IF NOT EXISTS idx_member_health_logs_logged_at ON member_health_logs(logged_at DESC);
