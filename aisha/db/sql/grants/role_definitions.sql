-- Grants: role_definitions

GRANT SELECT ON public.role_definitions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.role_definitions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.role_definitions TO service_role;
