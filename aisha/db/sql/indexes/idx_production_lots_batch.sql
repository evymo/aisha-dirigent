-- Index: idx_production_lots_batch
CREATE INDEX IF NOT EXISTS idx_production_lots_batch ON production_lots (batch_id) WHERE batch_id IS NOT NULL;
