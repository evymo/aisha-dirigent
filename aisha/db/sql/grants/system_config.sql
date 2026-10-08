-- Grants: system_config

GRANT SELECT ON public.system_config TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.system_config TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.system_config TO service_role;
