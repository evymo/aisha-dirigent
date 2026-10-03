-- Trigger: update_mcp_server_registry_updated_at
-- Maintains updated_at on mcp_server_registry row mutations (MCP lifecycle).

CREATE TRIGGER update_mcp_server_registry_updated_at
  BEFORE UPDATE ON public.mcp_server_registry
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
