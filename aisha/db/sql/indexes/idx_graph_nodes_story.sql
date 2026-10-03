-- Index: idx_graph_nodes_story
-- Table: graph_nodes

CREATE INDEX IF NOT EXISTS idx_graph_nodes_story
  ON public.graph_nodes (story_id)
  WHERE story_id IS NOT NULL;
