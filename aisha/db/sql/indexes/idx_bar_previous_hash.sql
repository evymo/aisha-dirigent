-- Index: idx_bar_previous_hash
-- Hash-chain integrity + tip lookup: each record_hash may be referenced as
-- previous_hash by AT MOST one row (structurally prevents silent forks — a
-- racing second writer errors instead of forking), and the chain walker
-- (fn_verify_audit_chain / fn_blockchain_audit_chain_link) resolves links via
-- this index. Genesis (64 zeros) is a value like any other → also unique.
CREATE UNIQUE INDEX IF NOT EXISTS idx_bar_previous_hash
  ON blockchain_audit_records (previous_hash);
