-- Policy: mcp_server_registry_service_all ON public.mcp_server_registry
-- Auto-extracted (back-port reconciliation)

CREATE POLICY "mcp_server_registry_service_all" ON public.mcp_server_registry AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text));
