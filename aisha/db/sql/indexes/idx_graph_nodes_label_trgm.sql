-- Index: idx_graph_nodes_label_trgm
-- Table: graph_nodes
-- pg_trgm for fuzzy entity_label match (entity dedup at extraction time)

CREATE INDEX IF NOT EXISTS idx_graph_nodes_label_trgm
  ON public.graph_nodes USING gin (entity_label gin_trgm_ops);
