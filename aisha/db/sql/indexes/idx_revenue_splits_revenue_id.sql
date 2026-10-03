-- Index: idx_revenue_splits_revenue_id
CREATE INDEX IF NOT EXISTS idx_revenue_splits_revenue_id ON revenue_splits(project_revenue_id);
