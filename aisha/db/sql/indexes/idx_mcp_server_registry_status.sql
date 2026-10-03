-- Index: idx_mcp_server_registry_status
-- Status + last-tested lookup (autopilot rechecks stale entries).

CREATE INDEX IF NOT EXISTS idx_mcp_server_registry_status
  ON public.mcp_server_registry (status, last_tested_at);
