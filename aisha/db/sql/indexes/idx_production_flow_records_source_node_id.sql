-- Index: idx_production_flow_records_source_node_id
CREATE INDEX IF NOT EXISTS idx_production_flow_records_source_node_id
  ON production_flow_records(source_node_id);
