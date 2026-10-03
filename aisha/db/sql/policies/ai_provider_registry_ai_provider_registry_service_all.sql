-- Policy: ai_provider_registry_service_all ON public.ai_provider_registry
-- Auto-extracted (back-port reconciliation)

CREATE POLICY "ai_provider_registry_service_all" ON public.ai_provider_registry AS PERMISSIVE FOR ALL TO public USING ((auth.role() = 'service_role'::text));
