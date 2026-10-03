-- Index: idx_mcp_server_registry_capabilities
-- Capability-tag containment search (GIN for array-overlap queries).

CREATE INDEX IF NOT EXISTS idx_mcp_server_registry_capabilities
  ON public.mcp_server_registry USING GIN (capability_tags);
