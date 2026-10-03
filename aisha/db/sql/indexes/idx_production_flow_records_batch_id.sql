-- Index: idx_production_flow_records_batch_id
CREATE INDEX IF NOT EXISTS idx_production_flow_records_batch_id
  ON production_flow_records(batch_id);
