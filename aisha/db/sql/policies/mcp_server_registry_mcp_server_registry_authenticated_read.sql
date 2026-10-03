-- Policy: mcp_server_registry_authenticated_read ON public.mcp_server_registry
-- Auto-extracted (back-port reconciliation)

CREATE POLICY "mcp_server_registry_authenticated_read" ON public.mcp_server_registry AS PERMISSIVE FOR SELECT TO public USING (((auth.uid() IS NOT NULL) OR (auth.role() = 'service_role'::text)));
