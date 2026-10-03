-- Grants: auth_provider_registry
-- Postgres checks table privileges BEFORE policies — an RLS policy without a
-- grant is unreachable (the twin_* lesson). SELECT for authenticated (policy
-- narrows per §19.4); full DML for service_role only. No anon: anonymous login
-- surfaces read via get_enabled_auth_providers() (SECURITY DEFINER).

GRANT SELECT ON public.auth_provider_registry TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.auth_provider_registry TO service_role;
