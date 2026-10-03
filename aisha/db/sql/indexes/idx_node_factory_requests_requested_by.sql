-- Index: idx_node_factory_requests_requested_by
-- Table: node_factory_requests

CREATE INDEX IF NOT EXISTS idx_node_factory_requests_requested_by
  ON public.node_factory_requests (requested_by);
