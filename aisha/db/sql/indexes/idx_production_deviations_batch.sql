-- Index: idx_production_deviations_batch
CREATE INDEX IF NOT EXISTS idx_production_deviations_batch ON production_deviations (batch_id) WHERE batch_id IS NOT NULL;
