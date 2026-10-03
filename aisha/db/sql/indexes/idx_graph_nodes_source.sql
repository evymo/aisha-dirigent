-- Index: idx_graph_nodes_source
-- Table: graph_nodes

CREATE INDEX IF NOT EXISTS idx_graph_nodes_source
  ON public.graph_nodes (source_table, source_id)
  WHERE source_id IS NOT NULL;
