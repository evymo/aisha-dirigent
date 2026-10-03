-- Grants: plugin_versions

GRANT SELECT ON public.plugin_versions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_versions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_versions TO service_role;
