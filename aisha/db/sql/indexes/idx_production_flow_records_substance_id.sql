-- Index: idx_production_flow_records_substance_id
CREATE INDEX IF NOT EXISTS idx_production_flow_records_substance_id
  ON production_flow_records(substance_id);
