-- Index: idx_graph_edges_run
-- Table: graph_edges

CREATE INDEX IF NOT EXISTS idx_graph_edges_run
  ON public.graph_edges (source_ai_run_id)
  WHERE source_ai_run_id IS NOT NULL;
