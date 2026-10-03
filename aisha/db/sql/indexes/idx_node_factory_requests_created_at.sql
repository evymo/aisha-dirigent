-- Index: idx_node_factory_requests_created_at
-- Table: node_factory_requests

CREATE INDEX IF NOT EXISTS idx_node_factory_requests_created_at
  ON public.node_factory_requests (created_at DESC);
