-- Grants: delivery_transitions

GRANT SELECT ON public.delivery_transitions TO anon;
GRANT DELETE, INSERT, SELECT, UPDATE ON public.delivery_transitions TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.delivery_transitions TO service_role;
