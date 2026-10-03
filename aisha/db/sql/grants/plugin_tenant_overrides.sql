-- Grants: plugin_tenant_overrides

GRANT SELECT ON public.plugin_tenant_overrides TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_tenant_overrides TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_tenant_overrides TO service_role;
