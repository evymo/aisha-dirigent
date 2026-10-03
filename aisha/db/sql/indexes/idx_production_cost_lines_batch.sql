-- Index: idx_production_cost_lines_batch
CREATE INDEX IF NOT EXISTS idx_production_cost_lines_batch ON production_cost_lines (batch_id) WHERE batch_id IS NOT NULL;
