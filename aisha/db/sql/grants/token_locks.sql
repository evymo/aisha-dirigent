-- Grants: token_locks

GRANT SELECT ON public.token_locks TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.token_locks TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.token_locks TO service_role;
