-- Index: idx_production_release_decided_at
CREATE INDEX IF NOT EXISTS idx_production_release_decided_at ON production_release_decisions (decision_at);
