-- Policy: web_tracking_registry_service_all ON public.web_tracking_registry
-- Writes are service-context only (materializer + admin RPCs as service_role).

CREATE POLICY "web_tracking_registry_service_all" ON public.web_tracking_registry AS PERMISSIVE FOR ALL TO public USING (
  auth.role() = 'service_role'::text
) WITH CHECK (
  auth.role() = 'service_role'::text
);
