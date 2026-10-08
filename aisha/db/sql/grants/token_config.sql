-- Grants: token_config

GRANT SELECT ON public.token_config TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.token_config TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.token_config TO service_role;
