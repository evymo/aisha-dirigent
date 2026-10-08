-- Grants: role_permissions

GRANT SELECT ON public.role_permissions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.role_permissions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.role_permissions TO service_role;
