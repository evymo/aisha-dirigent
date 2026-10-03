-- Index: idx_member_health_logs_user_ongoing
-- Table: member_health_logs

CREATE INDEX IF NOT EXISTS idx_member_health_logs_user_ongoing
  ON member_health_logs(user_id, started_at DESC) WHERE ended_at IS NULL;

-- member_product_plans indexes
