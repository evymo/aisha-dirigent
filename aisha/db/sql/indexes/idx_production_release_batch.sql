-- Index: idx_production_release_batch
CREATE INDEX IF NOT EXISTS idx_production_release_batch ON production_release_decisions (batch_id);
