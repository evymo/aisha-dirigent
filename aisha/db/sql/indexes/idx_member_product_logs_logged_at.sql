-- Index: idx_member_product_logs_logged_at
-- Table: member_product_logs

CREATE INDEX IF NOT EXISTS idx_member_product_logs_logged_at ON member_product_logs(logged_at DESC);
