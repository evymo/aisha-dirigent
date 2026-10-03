-- Index: idx_graph_edges_target
-- Table: graph_edges

CREATE INDEX IF NOT EXISTS idx_graph_edges_target
  ON public.graph_edges (target_node_id, relationship);
