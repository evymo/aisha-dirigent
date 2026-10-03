-- Index: idx_bar_dispatch_queue
-- Dispatcher: find queued/failed items ready for dispatch
CREATE INDEX IF NOT EXISTS idx_bar_dispatch_queue
  ON blockchain_audit_records (status, next_retry_at)
  WHERE status IN ('queued', 'failed');
