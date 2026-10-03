-- Index: idx_revenue_splits_recipient
CREATE INDEX IF NOT EXISTS idx_revenue_splits_recipient ON revenue_splits(recipient_id);
