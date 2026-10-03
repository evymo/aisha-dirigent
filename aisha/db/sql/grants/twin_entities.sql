-- Table privileges for public.twin_entities.
--
-- RLS is ENABLED on this table and its policies decide WHICH ROWS a caller may
-- see. That is a filter, not an entry ticket: Postgres checks table privileges
-- FIRST, so without a GRANT the policy is never consulted and the caller gets a
-- bare "permission denied". The twin_* tables had policies but no grants, which
-- is why every SECURITY INVOKER reader over them (get_twin_register and the
-- surface blocks built on it) could not render at all.
--
-- SELECT is therefore granted broadly and the policies keep doing the narrowing;
-- writes stay with service_role, which the audited RPCs run as.
GRANT SELECT ON public.twin_entities TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.twin_entities TO service_role;
