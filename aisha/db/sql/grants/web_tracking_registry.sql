-- Grants: web_tracking_registry
-- SELECT for authenticated (policy narrows per §19.4); full DML for service_role.
-- The anonymous web surface reads via get_active_web_tracking() (SECURITY DEFINER).

GRANT SELECT ON public.web_tracking_registry TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.web_tracking_registry TO service_role;
