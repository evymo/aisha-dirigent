-- Index: idx_production_flow_records_flow_date
CREATE INDEX IF NOT EXISTS idx_production_flow_records_flow_date
  ON production_flow_records(flow_date);
