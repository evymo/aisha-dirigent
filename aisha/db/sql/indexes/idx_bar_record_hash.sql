-- Index: idx_bar_record_hash
-- Hash-chain integrity: record_hash is the chain link identity — must be unique
-- (uniqueness holds by construction: each hash covers its distinct previous_hash).
-- Supports the anti-join tip lookup in fn_blockchain_audit_chain_link.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bar_record_hash
  ON blockchain_audit_records (record_hash);
