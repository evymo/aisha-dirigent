-- Index: idx_member_product_logs_user_logged
-- Table: member_product_logs

CREATE INDEX IF NOT EXISTS idx_member_product_logs_user_logged ON member_product_logs(user_id, logged_at DESC);

-- member_dashboard_widgets indexes
