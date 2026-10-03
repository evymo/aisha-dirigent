-- Index: idx_graph_edges_source
-- Table: graph_edges

CREATE INDEX IF NOT EXISTS idx_graph_edges_source
  ON public.graph_edges (source_node_id, relationship);
