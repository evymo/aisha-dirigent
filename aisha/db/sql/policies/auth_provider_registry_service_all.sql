-- Policy: auth_provider_registry_service_all ON public.auth_provider_registry
-- Writes are service-context only (materializers + Keycloak reconciler); operator
-- edits go through admin RPCs running as service_role.

CREATE POLICY "auth_provider_registry_service_all" ON public.auth_provider_registry AS PERMISSIVE FOR ALL TO public USING (
  auth.role() = 'service_role'::text
) WITH CHECK (
  auth.role() = 'service_role'::text
);
