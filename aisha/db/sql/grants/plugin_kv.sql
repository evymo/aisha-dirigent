-- Grants: plugin_kv

GRANT SELECT ON public.plugin_kv TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.plugin_kv TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.plugin_kv TO service_role;
