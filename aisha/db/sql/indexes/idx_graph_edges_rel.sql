-- Index: idx_graph_edges_rel
-- Table: graph_edges

CREATE INDEX IF NOT EXISTS idx_graph_edges_rel
  ON public.graph_edges (relationship);
