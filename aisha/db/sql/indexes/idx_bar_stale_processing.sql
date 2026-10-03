-- Index: idx_bar_stale_processing
-- Sweeper: find stale processing items
CREATE INDEX IF NOT EXISTS idx_bar_stale_processing
  ON blockchain_audit_records (processing_started_at)
  WHERE status = 'processing';
