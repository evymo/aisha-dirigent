-- Grants: token_burns

GRANT SELECT ON public.token_burns TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.token_burns TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.token_burns TO service_role;
