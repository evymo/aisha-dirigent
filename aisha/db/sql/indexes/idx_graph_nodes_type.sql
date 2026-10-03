-- Index: idx_graph_nodes_type
-- Table: graph_nodes

CREATE INDEX IF NOT EXISTS idx_graph_nodes_type
  ON public.graph_nodes (entity_type);
