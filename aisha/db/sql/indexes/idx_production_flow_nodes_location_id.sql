-- Index: idx_production_flow_nodes_location_id
CREATE INDEX IF NOT EXISTS idx_production_flow_nodes_location_id
  ON production_flow_nodes(location_id);
