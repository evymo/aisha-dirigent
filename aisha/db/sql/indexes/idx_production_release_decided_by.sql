-- Index: idx_production_release_decided_by
CREATE INDEX IF NOT EXISTS idx_production_release_decided_by ON production_release_decisions (decided_by);
