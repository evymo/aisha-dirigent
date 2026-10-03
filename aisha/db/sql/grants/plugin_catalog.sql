-- Grants: plugin_catalog

GRANT SELECT ON public.plugin_catalog TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_catalog TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_catalog TO service_role;
