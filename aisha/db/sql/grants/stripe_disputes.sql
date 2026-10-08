-- Grants: stripe_disputes

GRANT SELECT ON public.stripe_disputes TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.stripe_disputes TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.stripe_disputes TO service_role;
