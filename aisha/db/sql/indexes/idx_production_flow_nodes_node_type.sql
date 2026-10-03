-- Index: idx_production_flow_nodes_node_type
CREATE INDEX IF NOT EXISTS idx_production_flow_nodes_node_type
  ON production_flow_nodes(node_type);
