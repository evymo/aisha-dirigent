-- Index: idx_production_flow_records_target_node_id
CREATE INDEX IF NOT EXISTS idx_production_flow_records_target_node_id
  ON production_flow_records(target_node_id);
