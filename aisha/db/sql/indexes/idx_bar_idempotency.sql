-- Index: idx_bar_idempotency
-- Idempotency: one outbox record per source entity
CREATE UNIQUE INDEX IF NOT EXISTS idx_bar_idempotency
  ON blockchain_audit_records (reference_table, reference_id)
  WHERE reference_id IS NOT NULL;
