-- Grants: roles

GRANT SELECT ON public.roles TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.roles TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.roles TO service_role;
