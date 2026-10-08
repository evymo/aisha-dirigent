-- Grants: app_role_permissions

GRANT SELECT ON public.app_role_permissions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.app_role_permissions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.app_role_permissions TO service_role;
