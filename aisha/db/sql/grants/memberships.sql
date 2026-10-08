-- Grants: memberships

GRANT SELECT ON public.memberships TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.memberships TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.memberships TO service_role;
