-- Index: idx_bar_correlation
-- Correlation lookup
CREATE INDEX IF NOT EXISTS idx_bar_correlation
  ON blockchain_audit_records (correlation_id);
