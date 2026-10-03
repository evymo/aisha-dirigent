-- Index: idx_node_factory_requests_status
-- Table: node_factory_requests

CREATE INDEX IF NOT EXISTS idx_node_factory_requests_status
  ON public.node_factory_requests (status);
