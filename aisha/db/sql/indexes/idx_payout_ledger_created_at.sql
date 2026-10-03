-- Index: idx_payout_ledger_created_at
CREATE INDEX IF NOT EXISTS idx_payout_ledger_created_at ON payout_ledger(created_at DESC);
